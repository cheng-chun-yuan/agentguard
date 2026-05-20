import {
  encodeFunctionData,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { sessionClientFor, USDC_ADDRESS } from "./kernel";
import type { AgentRow } from "../db";
import { env } from "../env";
import { logActivity } from "./activity";
import { evaluatePolicy } from "./policy";

// USDC has 6 decimals on Base.
const TOKEN_REGISTRY: Record<string, { address: Address; decimals: number }> = {
  USDC: { address: USDC_ADDRESS, decimals: 6 },
};

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

export type TransferRequest = {
  agent: AgentRow;
  to: Address;
  token: string;
  amount: string; // human-readable, e.g. "0.001"
};

export type ExecuteResult =
  | {
      status: "submitted";
      tier: "auto" | "guard";
      userOpHash: Hex;
      txHash: Hex;
    }
  | {
      status: "pending_approval";
      tier: "human";
      approvalId: string;
      approvalUrl: string;
      reason: string;
    };

/**
 * Tier-1 execution path: sign + send a UserOp using the Agent's session key.
 *
 * On-chain policy (installed at provisioning) caps single-transfer value;
 * out-of-policy requests revert at the validator stage. Tier 2/3 routing
 * (Guard review + human approval) will be added in M2.
 */
export async function executeTransfer(
  req: TransferRequest,
): Promise<ExecuteResult> {
  const token = TOKEN_REGISTRY[req.token.toUpperCase()];
  if (!token) {
    throw new Error(
      `Unsupported token: ${req.token}. Supported: ${Object.keys(TOKEN_REGISTRY).join(", ")}`,
    );
  }

  const amountWei = parseUnits(req.amount, token.decimals);

  if (!req.agent.permission_account_blob) {
    throw new Error(
      `Agent ${req.agent.id} has no permission_account_blob — was provisioned before the M1.4.x migration. Recreate it via the dashboard.`,
    );
  }

  // ── (1) Off-chain policy evaluation ───────────────────────────────
  const policy = evaluatePolicy({
    agent: req.agent,
    to: req.to,
    amountWei,
  });

  // HUMAN tier never reaches the bundler. Log a pending row and return
  // an approval handle that the dashboard (M2.3) will action.
  if (policy.tier === "human") {
    const entry = logActivity({
      agentId: req.agent.id,
      kind: "transfer",
      tier: "human",
      status: "pending_approval",
      target: req.to,
      token: req.token.toUpperCase(),
      amount: req.amount,
      error: policy.reasons.join("; "),
    });
    return {
      status: "pending_approval",
      tier: "human",
      approvalId: entry.id,
      approvalUrl: `${env.DASHBOARD_ORIGIN}/?approval=${entry.id}`,
      reason: policy.reasons.join("; "),
    };
  }

  // AUTO / GUARD both execute via the session key. GUARD is "logged but
  // allowed" for now; later we can wire stricter guard behavior in.

  try {
    const client = await sessionClientFor({
      permissionAccountBlob: req.agent.permission_account_blob,
    });

    const callData = await client.account.encodeCalls([
      {
        to: token.address,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: [req.to, amountWei],
        }),
      },
    ]);

    const userOpHash = await client.sendUserOperation({ callData });
    const receipt = await client.waitForUserOperationReceipt({
      hash: userOpHash,
    });
    const txHash = receipt.receipt.transactionHash as Hex;

    logActivity({
      agentId: req.agent.id,
      kind: "transfer",
      tier: policy.tier,
      status: "submitted",
      target: req.to,
      token: req.token.toUpperCase(),
      amount: req.amount,
      userOpHash,
      txHash,
    });

    return { status: "submitted", tier: policy.tier, userOpHash, txHash };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logActivity({
      agentId: req.agent.id,
      kind: "transfer",
      tier: policy.tier,
      status: "rejected",
      target: req.to,
      token: req.token.toUpperCase(),
      amount: req.amount,
      error: message.slice(0, 500),
    });
    throw err;
  }
}
