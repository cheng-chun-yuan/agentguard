/**
 * Wallet stack helpers — wraps ZeroDev SDK with AgentGuard's policy defaults.
 *
 * Owner model (hackathon): single shared DEV_OWNER_PRIVATE_KEY signs the init
 * UserOp for every Agent. In production this becomes per-developer Privy
 * server wallets — see SPEC §3.2.
 *
 * Session key model: each Agent gets one bounded session key with a call
 * policy restricting it to ERC-20 transfers on a whitelist with a value cap.
 * Guard session key (a second bounded key with a higher cap) is a follow-up
 * milestone; for now Tier 2 actions go through the dev owner instead.
 */

import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { KERNEL_V3_3, getEntryPoint } from "@zerodev/sdk/constants";
import { toPermissionValidator } from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";
import {
  toCallPolicy,
  CallPolicyVersion,
  ParamCondition,
} from "@zerodev/permissions/policies";

import {
  createPublicClient,
  http,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import {
  generatePrivateKey,
  privateKeyToAccount,
  type PrivateKeyAccount,
} from "viem/accounts";
import { baseSepolia } from "viem/chains";

import { env } from "../env";

// ────────────────────────────────────────────────────────────────────
// Chain + constants
// ────────────────────────────────────────────────────────────────────

export const chain = baseSepolia;
export const entryPoint = getEntryPoint("0.7");
export const kernelVersion = KERNEL_V3_3;

// Base Sepolia testnet USDC (Circle's official test token)
export const USDC_ADDRESS: Address =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

// ERC-20 transfer ABI fragment — what session keys may call
const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

// Default Agent session key cap (Tier 1 — see SPEC §3.3).
// 0.01 USDC per call. Daily cap is enforced off-chain by the policy engine.
const AGENT_SESSION_PER_CALL_CAP = parseUnits("0.01", 6);

// ────────────────────────────────────────────────────────────────────
// Shared clients
// ────────────────────────────────────────────────────────────────────

export const publicClient = createPublicClient({
  chain,
  transport: http(env.BASE_SEPOLIA_RPC),
});

export const paymasterClient = createZeroDevPaymasterClient({
  chain,
  transport: http(env.ZERODEV_RPC),
});

// ────────────────────────────────────────────────────────────────────
// Public API
// ────────────────────────────────────────────────────────────────────

export type ProvisionResult = {
  smartAccountAddress: Address;
  ownerAddress: Address;
  agentSessionPrivateKey: Hex;
  agentSessionAddress: Address;
  initTxHash: Hex;
};

/**
 * Provision a new Agent's smart account:
 *   1. Build the dev owner's 7702 Kernel account
 *   2. Generate a fresh Agent session keypair
 *   3. Submit one UserOp that does 7702 auth + installs the Agent session
 *      validator (gas sponsored by paymaster)
 *
 * Returns the addresses + Agent session privkey for storage in the DB.
 */
export async function provisionAgent(): Promise<ProvisionResult> {
  const ownerAccount = privateKeyToAccount(env.DEV_OWNER_PRIVATE_KEY);

  // ── Owner (sudo) validator ──
  const sudoValidator = await signerToEcdsaValidator(publicClient, {
    signer: ownerAccount,
    entryPoint,
    kernelVersion,
  });

  // ── Fresh Agent session key ──
  const agentSessionPrivateKey = generatePrivateKey();
  const agentSessionAccount = privateKeyToAccount(agentSessionPrivateKey);
  const agentSessionSigner = await toECDSASigner({
    signer: agentSessionAccount,
  });

  const agentCallPolicy = toCallPolicy({
    policyVersion: CallPolicyVersion.V0_0_4,
    permissions: [
      {
        target: USDC_ADDRESS,
        valueLimit: 0n,
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [
          null, // recipient — no constraint at this layer
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
    policies: [agentCallPolicy],
  });

  // ── Kernel account with both validators ──
  const kernelAccount = await createKernelAccount(publicClient, {
    plugins: {
      sudo: sudoValidator,
      regular: agentPermissionValidator,
    },
    entryPoint,
    kernelVersion,
    eip7702Account: ownerAccount,
  } as Parameters<typeof createKernelAccount>[1]);

  // ── Submit init UserOp (owner signs; this triggers 7702 auth +
  //    permission-validator installation in one shot) ──
  const ownerKernelAccount = await createKernelAccount(publicClient, {
    plugins: { sudo: sudoValidator },
    entryPoint,
    kernelVersion,
    eip7702Account: ownerAccount,
  } as Parameters<typeof createKernelAccount>[1]);

  const ownerClient = createKernelAccountClient({
    account: ownerKernelAccount,
    chain,
    bundlerTransport: http(env.ZERODEV_RPC),
    paymaster: paymasterClient,
  });

  const opHash = await ownerClient.sendUserOperation({
    callData: await ownerKernelAccount.encodeCalls([
      { to: ownerAccount.address, value: 0n, data: "0x" },
    ]),
  });

  const receipt = await ownerClient.waitForUserOperationReceipt({
    hash: opHash,
  });

  return {
    smartAccountAddress: kernelAccount.address as Address,
    ownerAddress: ownerAccount.address,
    agentSessionPrivateKey,
    agentSessionAddress: agentSessionAccount.address,
    initTxHash: receipt.receipt.transactionHash as Hex,
  };
}

/** Helper that materializes an Agent's session-key-signed client from stored privkey. */
export async function sessionClientFor(opts: {
  ownerAddress: Address;
  agentSessionPrivateKey: Hex;
}) {
  const ownerAccount = privateKeyToAccount(env.DEV_OWNER_PRIVATE_KEY);
  if (ownerAccount.address.toLowerCase() !== opts.ownerAddress.toLowerCase()) {
    throw new Error("Agent owner does not match DEV_OWNER_PRIVATE_KEY");
  }

  const sudoValidator = await signerToEcdsaValidator(publicClient, {
    signer: ownerAccount,
    entryPoint,
    kernelVersion,
  });

  const sessionAccount: PrivateKeyAccount = privateKeyToAccount(
    opts.agentSessionPrivateKey,
  );
  const sessionSigner = await toECDSASigner({ signer: sessionAccount });

  const policy = toCallPolicy({
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

  const permissionValidator = await toPermissionValidator(publicClient, {
    entryPoint,
    kernelVersion,
    signer: sessionSigner,
    policies: [policy],
  });

  const kernelAccount = await createKernelAccount(publicClient, {
    plugins: { sudo: sudoValidator, regular: permissionValidator },
    entryPoint,
    kernelVersion,
    eip7702Account: ownerAccount,
  } as Parameters<typeof createKernelAccount>[1]);

  return createKernelAccountClient({
    account: kernelAccount,
    chain,
    bundlerTransport: http(env.ZERODEV_RPC),
    paymaster: paymasterClient,
  });
}
