/**
 * Wallet stack helpers — wraps ZeroDev SDK with AgentGuard's policy defaults.
 *
 * Owner model:
 *   - Dashboard path (production-shape): each developer's Privy embedded
 *     wallet signs their own 7702 auth + init UserOp client-side via
 *     `apps/dashboard/src/lib/wallet/provision.ts`. Backend never touches
 *     the owner key.
 *   - Headless path (this file, used by `apps/example` smoke + `POST
 *     /agents/`): a single shared `DEV_OWNER_PRIVATE_KEY` signs the init
 *     UserOp. Useful for E2E smoke tests; not exposed to end users.
 *
 * Session key model: each Agent gets one bounded V2 session key with a
 * call policy restricting it to ERC-20 USDC transfers ≤ 0.01 USDC per
 * call, 100 calls / 24h, auto-expiring after 24h. This single key serves
 * BOTH AUTO and GUARD tiers — off-chain policy decides the tier label,
 * the on-chain cap is identical for both. HUMAN tier escalates to the
 * owner key and never touches the session key.
 *
 * V3 (a second, separately-capped session key dedicated to GUARD tier
 * for stronger separation-of-duties) is post-hackathon roadmap. See
 * SPEC §3.3 "Roadmap" row.
 */

import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { KERNEL_V3_3, getEntryPoint } from "@zerodev/sdk/constants";
import {
  deserializePermissionAccount,
  serializePermissionAccount,
  toPermissionValidator,
} from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";
import {
  toCallPolicy,
  toRateLimitPolicy,
  toTimestampPolicy,
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
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
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
  permissionAccountBlob: string;
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

  // Match the dashboard's session policies: TimestampPolicy (24h) gives
  // automatic expiry even if backend never revokes; RateLimitPolicy caps
  // calls per window even if a leaked key bypasses our backend.
  const SESSION_VALIDITY_SECONDS = 24 * 60 * 60;
  const agentTimestampPolicy = toTimestampPolicy({
    validUntil: Math.floor(Date.now() / 1000) + SESSION_VALIDITY_SECONDS,
  });
  const agentRateLimitPolicy = toRateLimitPolicy({
    interval: SESSION_VALIDITY_SECONDS,
    count: 100,
  });

  const agentPermissionValidator = await toPermissionValidator(publicClient, {
    entryPoint,
    kernelVersion,
    signer: agentSessionSigner,
    policies: [agentCallPolicy, agentTimestampPolicy, agentRateLimitPolicy],
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

  // Serialize the permission account so the backend can later reconstruct
  // a session-key-signed kernel client without the owner key.
  const permissionAccountBlob = await serializePermissionAccount(
    kernelAccount as Parameters<typeof serializePermissionAccount>[0],
    agentSessionPrivateKey,
  );

  return {
    smartAccountAddress: kernelAccount.address as Address,
    ownerAddress: ownerAccount.address,
    agentSessionPrivateKey,
    agentSessionAddress: agentSessionAccount.address,
    permissionAccountBlob,
    initTxHash: receipt.receipt.transactionHash as Hex,
  };
}

/**
 * Build a session-key-signed client for an existing Agent.
 *
 * Uses the serialized permission-account blob produced at provisioning
 * time. `deserializePermissionAccount` reconstructs a kernel account with
 * only the regular (session-key) validator — no sudo signer involved.
 * The blob embeds the session key, the policy, the smart-account address,
 * and the 7702 authorization, so the backend never needs the owner key.
 */
export async function sessionClientFor(opts: {
  permissionAccountBlob: string;
}) {
  const account = await deserializePermissionAccount(
    publicClient,
    entryPoint,
    kernelVersion,
    opts.permissionAccountBlob,
  );

  return createKernelAccountClient({
    account,
    chain,
    bundlerTransport: http(env.ZERODEV_RPC),
    paymaster: paymasterClient,
  });
}
