/**
 * Client-side Agent provisioning — runs in the browser.
 *
 * Privy keeps the embedded wallet's private key in its TEE, so the JSON-RPC
 * account we get from `useWallets()` cannot sign an EIP-7702 authorization
 * via viem's `signAuthorization` action. Instead Privy ships
 * `useSign7702Authorization` which routes through the TEE. We pre-sign the
 * authorization in the component and pass the result here as a callback.
 *
 * Flow:
 *   1. Sudo validator from the Privy EIP-1193 provider (regular signing —
 *      signMessage / signTypedData — does work over EIP-1193, only
 *      signAuthorization doesn't).
 *   2. Generate a fresh Agent session keypair + build its call policy.
 *   3. Ask Privy to sign the 7702 authorization for the Kernel v3.3
 *      implementation contract.
 *   4. Create the Kernel account passing BOTH `eip7702Auth` (so ZeroDev
 *      uses our pre-signed authorization and short-circuits its internal
 *      signAuthorization call) AND `eip7702Account` (so ZeroDev knows the
 *      EOA address — otherwise it derives accountAddress as `zeroAddress`
 *      and verifyAuthorization fails with "Authorization verification
 *      failed").
 *   5. Submit the init UserOp via the bundler with paymaster sponsorship.
 *   6. POST the result to the backend so it can store the agent session key
 *      and mint an API key.
 */

import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import {
  serializePermissionAccount,
  toPermissionValidator,
} from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";
import {
  toCallPolicy,
  CallPolicyVersion,
  ParamCondition,
} from "@zerodev/permissions/policies";

import {
  createWalletClient,
  custom,
  http,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";
import { getTransactionCount } from "viem/actions";
import {
  generatePrivateKey,
  privateKeyToAccount,
  type SignAuthorizationReturnType,
} from "viem/accounts";
import { recoverAuthorizationAddress } from "viem/utils";

import {
  DEFAULT_ON_CHAIN_CAP_ATOMIC,
  ERC20_TRANSFER_ABI,
  KERNEL_V3_3_IMPLEMENTATION_ADDRESS,
  USDC_ADDRESS,
  chain,
  entryPoint,
  kernelVersion,
} from "./constants";
import { getBackendUrl, getZeroDevRpc, publicClient } from "./clients";

export type SignAuthorizationFn = (params: {
  contractAddress: Address;
  chainId?: number;
  nonce?: number;
  executor?: "self" | Address;
}) => Promise<SignAuthorizationReturnType>;

export type ProvisionInput = {
  /** Friendly name for the agent (shown in dashboard). */
  name: string;
  /** EIP-1193 provider from the Privy embedded wallet
   *  (`await wallet.getEthereumProvider()`). Used for regular signing. */
  ownerProvider: EIP1193Provider;
  /** EOA address of the owner. */
  ownerAddress: Address;
  /** Privy's `useSign7702Authorization().signAuthorization` — pre-signs the
   *  7702 auth so ZeroDev doesn't try to sign it via viem (which fails on
   *  Privy's JSON-RPC accounts). */
  signAuthorization: SignAuthorizationFn;
  /** On-chain validator cap in USDC atomic units (6 decimals).
   *  Defaults to 0.01 USDC. This becomes the hard limit baked into the
   *  Kernel permission validator; changing it later requires rotating the
   *  session key. */
  onChainCapAtomic?: bigint;
};

export type ProvisionedAgent = {
  id: string;
  name: string;
  apiKey: string;
  smartAccountAddress: Address;
  ownerAddress: Address;
  agentSessionAddress: Address;
  initTxHash: Hex;
  chain: string;
  createdAt: number;
};

export async function provisionAgent(
  input: ProvisionInput,
): Promise<ProvisionedAgent> {
  // ── (1) Sudo validator from Privy owner ──
  // Build a viem WalletClient whose .account.address is the Privy embedded
  // wallet's address explicitly. We pass the *whole* WalletClient to
  // signerToEcdsaValidator so ZeroDev's `toSigner` takes the
  // `signer?.account` branch and skips the `eth_requestAccounts[0]` probe —
  // that probe is unreliable when MetaMask / Phantom / Coinbase wallet
  // extensions are also injecting providers.
  const ownerWalletClient = createWalletClient({
    account: input.ownerAddress,
    chain,
    transport: custom(input.ownerProvider),
  });
  const sudoValidator = await signerToEcdsaValidator(publicClient, {
    signer: ownerWalletClient,
    entryPoint,
    kernelVersion,
  });

  // ── (2) Mint fresh Agent session keypair ──
  const agentSessionPrivateKey = generatePrivateKey();
  const agentSessionAccount = privateKeyToAccount(agentSessionPrivateKey);
  const agentSessionSigner = await toECDSASigner({
    signer: agentSessionAccount,
  });

  const onChainCap = input.onChainCapAtomic ?? DEFAULT_ON_CHAIN_CAP_ATOMIC;
  const callPolicy = toCallPolicy({
    policyVersion: CallPolicyVersion.V0_0_4,
    permissions: [
      {
        target: USDC_ADDRESS,
        valueLimit: 0n,
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [
          null,
          {
            condition: ParamCondition.LESS_THAN_OR_EQUAL,
            value: onChainCap,
          },
        ],
      },
    ],
  });

  const agentPermissionValidator = await toPermissionValidator(publicClient, {
    entryPoint,
    kernelVersion,
    signer: agentSessionSigner,
    policies: [callPolicy],
  });

  // ── (3) Pre-sign 7702 authorization via Privy ──
  // In ERC-4337 the bundler submits the tx, not the EOA — so the EOA's
  // nonce is unchanged when the auth is processed. The auth.nonce must
  // therefore equal the EOA's CURRENT on-chain nonce (typically 0 for a
  // fresh Privy wallet). Passing `executor: "self"` would tell Privy to
  // return current+1, which is wrong for this flow.
  const currentNonce = await getTransactionCount(publicClient, {
    address: input.ownerAddress,
  });
  const authorization = await input.signAuthorization({
    contractAddress: KERNEL_V3_3_IMPLEMENTATION_ADDRESS,
    chainId: chain.id,
    nonce: currentNonce,
  });
  console.log("[agentguard] Privy 7702 authorization:", authorization);

  // Self-check: recover the signer from the auth and confirm it matches the
  // Privy embedded wallet address. If this fails, the issue is upstream of
  // ZeroDev (Privy returned a malformed signature) — don't bother with
  // createKernelAccount until we fix the signing path.
  const recovered = await recoverAuthorizationAddress({ authorization });
  console.log(
    "[agentguard] Recovered signer:",
    recovered,
    "expected:",
    input.ownerAddress,
  );
  if (recovered.toLowerCase() !== input.ownerAddress.toLowerCase()) {
    throw new Error(
      `Authorization signer mismatch: recovered ${recovered}, expected ${input.ownerAddress}`,
    );
  }

  // ── (4) Kernel account in 7702 mode (pre-signed auth) ──
  const kernelAccount = await createKernelAccount(publicClient, {
    plugins: {
      sudo: sudoValidator,
      regular: agentPermissionValidator,
    },
    entryPoint,
    kernelVersion,
    eip7702Auth: authorization,
    eip7702Account: ownerWalletClient,
  } as Parameters<typeof createKernelAccount>[1]);

  // ── (5) Send init UserOp (sudo-only client, also uses the same auth) ──
  const ZERODEV_RPC = getZeroDevRpc();
  const paymasterClient = createZeroDevPaymasterClient({
    chain,
    transport: http(ZERODEV_RPC),
  });

  const ownerOnlyAccount = await createKernelAccount(publicClient, {
    plugins: { sudo: sudoValidator },
    entryPoint,
    kernelVersion,
    eip7702Auth: authorization,
    eip7702Account: ownerWalletClient,
  } as Parameters<typeof createKernelAccount>[1]);

  const ownerClient = createKernelAccountClient({
    account: ownerOnlyAccount,
    chain,
    bundlerTransport: http(ZERODEV_RPC),
    paymaster: paymasterClient,
  });

  const opHash = await ownerClient.sendUserOperation({
    callData: await ownerOnlyAccount.encodeCalls([
      { to: input.ownerAddress, value: 0n, data: "0x" },
    ]),
  });
  const receipt = await ownerClient.waitForUserOperationReceipt({
    hash: opHash,
  });
  const initTxHash = receipt.receipt.transactionHash as Hex;

  // Serialize the permission account so the backend can sign UserOps via
  // the session key alone — without ever needing the owner key.
  const permissionAccountBlob = await serializePermissionAccount(
    kernelAccount as Parameters<typeof serializePermissionAccount>[0],
    agentSessionPrivateKey,
  );

  // ── (6) Register with backend ──
  const res = await fetch(`${getBackendUrl()}/agents/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      smartAccountAddress: kernelAccount.address,
      ownerAddress: input.ownerAddress,
      agentSessionPubkey: agentSessionAccount.address,
      agentSessionPrivkey: agentSessionPrivateKey,
      permissionAccountBlob,
      initTxHash,
      onChainCapAtomic: onChainCap.toString(),
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Backend registration failed (${res.status}): ${text}`);
  }

  const data = (await res.json()) as {
    agent: {
      id: string;
      name: string;
      chain: string;
      smartAccountAddress: string;
      ownerAddress: string;
      agentSessionAddress: string;
      initTxHash: string;
      status: string;
      createdAt: number;
    };
    apiKey: string;
  };

  return {
    id: data.agent.id,
    name: data.agent.name,
    apiKey: data.apiKey,
    smartAccountAddress: data.agent.smartAccountAddress as Address,
    ownerAddress: data.agent.ownerAddress as Address,
    agentSessionAddress: data.agent.agentSessionAddress as Address,
    initTxHash: data.agent.initTxHash as Hex,
    chain: data.agent.chain,
    createdAt: data.agent.createdAt,
  };
}
