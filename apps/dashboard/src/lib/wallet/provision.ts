/**
 * Client-side Agent provisioning — runs in the browser.
 *
 * Flow:
 *   1. Caller gives us the Privy embedded wallet's viem-compatible Account.
 *   2. We build a sudo (owner) validator backed by that Account.
 *   3. Mint a fresh Agent session keypair locally; build its permission
 *      validator with the policy (USDC transfer ≤ 0.01).
 *   4. Create the Kernel account in 7702 mode at the same address as the
 *      Privy EOA.
 *   5. Send the init UserOp — Privy popup signs both the 7702 authorization
 *      and the operation. Paymaster sponsors gas.
 *   6. POST the resulting smart-account address + agent session privkey to
 *      the backend so it can be stored against an API key.
 */

import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { toPermissionValidator } from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";
import {
  toCallPolicy,
  CallPolicyVersion,
  ParamCondition,
} from "@zerodev/permissions/policies";

import { http, type Address, type EIP1193Provider, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import {
  AGENT_SESSION_PER_CALL_CAP,
  ERC20_TRANSFER_ABI,
  USDC_ADDRESS,
  chain,
  entryPoint,
  kernelVersion,
} from "./constants";
import { getBackendUrl, getZeroDevRpc, publicClient } from "./clients";

export type ProvisionInput = {
  /** Friendly name for the agent (shown in dashboard). */
  name: string;
  /** EIP-1193 provider from the Privy embedded wallet
   *  (`await wallet.getEthereumProvider()`). */
  ownerProvider: EIP1193Provider;
  /** EOA address of the owner — matches the Privy embedded wallet. */
  ownerAddress: Address;
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
  // ZeroDev accepts a raw EIP-1193 provider as `signer` — it constructs an
  // internal account from it and routes signing through the provider, which
  // in Privy's case dispatches to the TEE.
  const sudoValidator = await signerToEcdsaValidator(publicClient, {
    signer: input.ownerProvider,
    entryPoint,
    kernelVersion,
  });

  // ── (2) Mint fresh Agent session keypair ──
  const agentSessionPrivateKey = generatePrivateKey();
  const agentSessionAccount = privateKeyToAccount(agentSessionPrivateKey);
  const agentSessionSigner = await toECDSASigner({
    signer: agentSessionAccount,
  });

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
            value: AGENT_SESSION_PER_CALL_CAP,
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

  // ── (3) Kernel account, 7702 mode ──
  const kernelAccount = await createKernelAccount(publicClient, {
    plugins: {
      sudo: sudoValidator,
      regular: agentPermissionValidator,
    },
    entryPoint,
    kernelVersion,
    eip7702Account: input.ownerProvider,
  } as Parameters<typeof createKernelAccount>[1]);

  // ── (4) Send init UserOp (Privy popup signs) ──
  const ZERODEV_RPC = getZeroDevRpc();
  const paymasterClient = createZeroDevPaymasterClient({
    chain,
    transport: http(ZERODEV_RPC),
  });

  const ownerOnlyAccount = await createKernelAccount(publicClient, {
    plugins: { sudo: sudoValidator },
    entryPoint,
    kernelVersion,
    eip7702Account: input.ownerProvider,
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

  // ── (5) Register with backend ──
  const res = await fetch(`${getBackendUrl()}/agents/register`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      name: input.name,
      smartAccountAddress: kernelAccount.address,
      ownerAddress: input.ownerAddress,
      agentSessionPubkey: agentSessionAccount.address,
      agentSessionPrivkey: agentSessionPrivateKey,
      initTxHash,
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
