/**
 * Off-chain policy engine — runs before any on-chain submission and
 * routes each request into one of three tiers.
 *
 * For SPEC §3.3 (Tier 1/2/3):
 *   - AUTO   ≤ per-call cap AND recipient seen before  → session key signs
 *   - GUARD  small overage  OR  new recipient          → session key signs but log
 *   - HUMAN  large overage  OR  daily cap exceeded     → bounce to dashboard
 *
 * Thresholds are deliberately tight for the hackathon demo so a single
 * smoke-test run exercises all three tiers without needing testnet drips.
 */

import { parseUnits, type Address } from "viem";
import { db, type AgentRow } from "../db";

// All caps are denominated in the USDC base unit (6 decimals).
export const POLICY = {
  /** ≤ this routes to AUTO (when recipient is seen). */
  AUTO_PER_CALL_MAX: parseUnits("0.001", 6),
  /** ≤ this routes to GUARD. Anything above → HUMAN. */
  GUARD_PER_CALL_MAX: parseUnits("0.005", 6),
  /** Cumulative cap across the rolling 24h window. */
  DAILY_MAX: parseUnits("0.02", 6),
};

export type Tier = "auto" | "guard" | "human";

export type PolicyEvaluation = {
  tier: Tier;
  reasons: string[];
};

export type PolicyInput = {
  agent: AgentRow;
  to: Address;
  amountWei: bigint;
};

export function evaluatePolicy(input: PolicyInput): PolicyEvaluation {
  const reasons: string[] = [];
  let tier: Tier = "auto";

  // Per-call amount tier
  if (input.amountWei > POLICY.GUARD_PER_CALL_MAX) {
    tier = "human";
    reasons.push(
      `amount exceeds GUARD cap (max ${formatUsdc(POLICY.GUARD_PER_CALL_MAX)})`,
    );
  } else if (input.amountWei > POLICY.AUTO_PER_CALL_MAX) {
    tier = bump(tier, "guard");
    reasons.push(
      `amount exceeds AUTO cap (max ${formatUsdc(POLICY.AUTO_PER_CALL_MAX)})`,
    );
  }

  // Recipient familiarity — first-time recipient bumps AUTO → GUARD.
  const seenBefore = db
    .prepare(
      `SELECT 1 FROM tx_log
       WHERE agent_id = ? AND lower(target) = lower(?) AND status = 'submitted'
       LIMIT 1`,
    )
    .get(input.agent.id, input.to);
  if (!seenBefore) {
    tier = bump(tier, "guard");
    reasons.push("first-time recipient");
  }

  // Rolling daily cap.
  const since = Date.now() - 24 * 60 * 60 * 1000;
  const dailyRows = db
    .prepare(
      `SELECT amount FROM tx_log
       WHERE agent_id = ? AND status = 'submitted' AND created_at > ?`,
    )
    .all(input.agent.id, since) as { amount: string | null }[];

  let dailyTotal = 0n;
  for (const r of dailyRows) {
    if (!r.amount) continue;
    try {
      dailyTotal += parseUnits(r.amount, 6);
    } catch {
      // legacy rows with non-numeric amounts — skip silently
    }
  }
  if (dailyTotal + input.amountWei > POLICY.DAILY_MAX) {
    tier = "human";
    reasons.push(
      `daily total ${formatUsdc(dailyTotal + input.amountWei)} would exceed cap (${formatUsdc(POLICY.DAILY_MAX)})`,
    );
  }

  if (reasons.length === 0) reasons.push("within all policy thresholds");
  return { tier, reasons };
}

// ── helpers ─────────────────────────────────────────────────────────

const tierRank: Record<Tier, number> = { auto: 0, guard: 1, human: 2 };

function bump(a: Tier, b: Tier): Tier {
  return tierRank[a] >= tierRank[b] ? a : b;
}

function formatUsdc(wei: bigint): string {
  const whole = wei / 1_000_000n;
  const frac = wei % 1_000_000n;
  // Trim trailing zeros for readability
  const fracStr = frac.toString().padStart(6, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr} USDC` : `${whole} USDC`;
}
