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
import { evaluatePolicy, type Tier } from "./policy";
import { aggregate, runDetectors } from "./detect/registry";
import type { ChatMessage } from "./detect/types";

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

export type IntentContext = {
  userPrompt?: string;
  conversationLog?: ChatMessage[];
};

export type TransferRequest = {
  agent: AgentRow;
  to: Address;
  token: string;
  amount: string;
  /** Optional upstream context for the AI Detect layer (SPEC §4.3). */
  intentContext?: IntentContext;
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

const TIER_RANK: Record<Tier, number> = { auto: 0, guard: 1, human: 2 };

function maxTier(a: Tier, b: Tier): Tier {
  return TIER_RANK[a] >= TIER_RANK[b] ? a : b;
}

function bumpTier(t: Tier, by: 0 | 1 | 2): Tier {
  const ranks: Tier[] = ["auto", "guard", "human"];
  const next = Math.min(TIER_RANK[t] + by, 2);
  return ranks[next]!;
}

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

  // ── (1) AI Detect — run all providers in parallel against the intent ──
  const detectorResults = req.intentContext
    ? await runDetectors({
        userPrompt: req.intentContext.userPrompt,
        conversationLog: req.intentContext.conversationLog,
        proposedAction: {
          kind: "transfer",
          to: req.to,
          token: req.token.toUpperCase(),
          amount: req.amount,
        },
        agentMetadata: {
          agentId: req.agent.id,
          name: req.agent.name,
          chain: req.agent.chain,
        },
      })
    : [];
  const detectAggregate = aggregate(detectorResults);

  // ── (2) Off-chain policy (amount / recipient / daily) ────────────────
  const policy = evaluatePolicy({
    agent: req.agent,
    to: req.to,
    amountWei,
  });

  // ── (3) Combine — final tier is max(policy tier, detect-bumped tier) ──
  const tier: Tier = maxTier(policy.tier, bumpTier("auto", detectAggregate.tierBump));
  const combinedReasons = [...policy.reasons, ...detectAggregate.reasons];
  const detectionJson =
    detectorResults.length > 0
      ? JSON.stringify({
          worst: detectAggregate.worst,
          results: detectorResults.map((r) => ({
            provider: r.providerName,
            verdict: r.verdict,
            score: r.score,
            reasons: r.reasons,
            latencyMs: r.latencyMs,
          })),
        })
      : undefined;

  // Which guard layer(s) caused the tier escalation?
  const triggers: ("policy" | "agent")[] = [];
  if (policy.tier !== "auto") triggers.push("policy");
  if (detectAggregate.worst !== "safe") triggers.push("agent");
  const triggeredBy = triggers.length > 0 ? triggers.join(",") : undefined;

  // HUMAN tier never reaches the bundler.
  if (tier === "human") {
    const entry = logActivity({
      agentId: req.agent.id,
      kind: "transfer",
      tier: "human",
      status: "pending_approval",
      target: req.to,
      token: req.token.toUpperCase(),
      amount: req.amount,
      error: combinedReasons.join("; "),
      detection: detectionJson,
      triggeredBy,
    });
    return {
      status: "pending_approval",
      tier: "human",
      approvalId: entry.id,
      approvalUrl: `${env.DASHBOARD_ORIGIN}/?approval=${entry.id}`,
      reason: combinedReasons.join("; "),
    };
  }

  // AUTO / GUARD: execute via the session key. Detection bumped tier is
  // already merged in. GUARD-tier rows show the detect reasons too.
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
      tier,
      status: "submitted",
      target: req.to,
      token: req.token.toUpperCase(),
      amount: req.amount,
      userOpHash,
      txHash,
      detection: detectionJson,
      triggeredBy,
    });

    return { status: "submitted", tier, userOpHash, txHash };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    logActivity({
      agentId: req.agent.id,
      kind: "transfer",
      tier,
      status: "rejected",
      target: req.to,
      token: req.token.toUpperCase(),
      amount: req.amount,
      error: message.slice(0, 500),
      detection: detectionJson,
      triggeredBy,
    });
    throw err;
  }
}
