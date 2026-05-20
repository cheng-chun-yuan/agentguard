/**
 * Off-chain policy engine — runs before any on-chain submission and
 * routes each request into one of three tiers (SPEC §3.3).
 *
 *   - AUTO   ≤ per-call cap AND recipient seen before
 *   - GUARD  small overage  OR  new recipient
 *   - HUMAN  large overage  OR  daily cap exceeded  OR  off-whitelist
 *
 * Policy is per-agent: each row in `agents` has an optional `policy_json`
 * column that overrides the defaults. Unset fields fall back to defaults
 * defined here.
 */

import { formatUnits, parseUnits, type Address } from "viem";
import { db, type AgentRow } from "../db";

/** Defaults — applied when an agent row has no override. Kept tight enough
 *  for the hackathon demo to surface all three tiers in a single smoke run. */
export const DEFAULT_POLICY = {
  autoPerCallAtomic: parseUnits("0.001", 6),
  guardPerCallAtomic: parseUnits("0.005", 6),
  dailyAtomic: parseUnits("1", 6),
  whitelist: [] as Address[],
  /** When true, transfers to non-whitelisted addresses are forced to HUMAN. */
  requireWhitelist: false,
};

/** What an agent's policy override stores in DB (all fields optional). */
export type StoredPolicy = {
  autoPerCallAtomic?: string;
  guardPerCallAtomic?: string;
  dailyAtomic?: string;
  whitelist?: string[];
  requireWhitelist?: boolean;
};

/** Resolved policy with all fields filled in (defaults + override). */
export type ResolvedPolicy = {
  autoPerCallAtomic: bigint;
  guardPerCallAtomic: bigint;
  dailyAtomic: bigint;
  whitelist: Address[];
  requireWhitelist: boolean;
};

export type ResolvedPolicyHuman = {
  autoPerCallUsdc: string;
  guardPerCallUsdc: string;
  dailyUsdc: string;
  whitelist: string[];
  requireWhitelist: boolean;
};

export function resolvePolicy(agent: AgentRow): ResolvedPolicy {
  let stored: StoredPolicy = {};
  if (agent.policy_json) {
    try {
      stored = JSON.parse(agent.policy_json);
    } catch {
      // Bad JSON — fall back to defaults silently
    }
  }
  return {
    autoPerCallAtomic: stored.autoPerCallAtomic
      ? BigInt(stored.autoPerCallAtomic)
      : DEFAULT_POLICY.autoPerCallAtomic,
    guardPerCallAtomic: stored.guardPerCallAtomic
      ? BigInt(stored.guardPerCallAtomic)
      : DEFAULT_POLICY.guardPerCallAtomic,
    dailyAtomic: stored.dailyAtomic
      ? BigInt(stored.dailyAtomic)
      : DEFAULT_POLICY.dailyAtomic,
    whitelist: (stored.whitelist as Address[] | undefined) ?? DEFAULT_POLICY.whitelist,
    requireWhitelist:
      stored.requireWhitelist ?? DEFAULT_POLICY.requireWhitelist,
  };
}

export function toHumanPolicy(resolved: ResolvedPolicy): ResolvedPolicyHuman {
  return {
    autoPerCallUsdc: formatUnits(resolved.autoPerCallAtomic, 6),
    guardPerCallUsdc: formatUnits(resolved.guardPerCallAtomic, 6),
    dailyUsdc: formatUnits(resolved.dailyAtomic, 6),
    whitelist: resolved.whitelist,
    requireWhitelist: resolved.requireWhitelist,
  };
}

/** Write a stored policy back to an agent row. Validates structure. */
export function updateAgentPolicy(
  agentId: string,
  patch: Partial<ResolvedPolicyHuman>,
): { ok: true } | { ok: false; reason: string } {
  // Read current resolved policy to merge against
  const row = db
    .prepare(`SELECT * FROM agents WHERE id = ?`)
    .get(agentId) as AgentRow | undefined;
  if (!row) return { ok: false, reason: "agent not found" };
  const current = toHumanPolicy(resolvePolicy(row));
  const next: ResolvedPolicyHuman = {
    autoPerCallUsdc: patch.autoPerCallUsdc ?? current.autoPerCallUsdc,
    guardPerCallUsdc: patch.guardPerCallUsdc ?? current.guardPerCallUsdc,
    dailyUsdc: patch.dailyUsdc ?? current.dailyUsdc,
    whitelist: patch.whitelist ?? current.whitelist,
    requireWhitelist: patch.requireWhitelist ?? current.requireWhitelist,
  };

  // Sanity: ordered (auto ≤ guard ≤ daily), valid USDC decimals
  let storedPolicy: StoredPolicy;
  try {
    const auto = parseUnits(next.autoPerCallUsdc, 6);
    const guard = parseUnits(next.guardPerCallUsdc, 6);
    const daily = parseUnits(next.dailyUsdc, 6);
    if (auto > guard) return { ok: false, reason: "autoPerCallUsdc must be ≤ guardPerCallUsdc" };
    if (guard > daily) return { ok: false, reason: "guardPerCallUsdc must be ≤ dailyUsdc" };
    storedPolicy = {
      autoPerCallAtomic: auto.toString(),
      guardPerCallAtomic: guard.toString(),
      dailyAtomic: daily.toString(),
      whitelist: next.whitelist.map((a) => a.toLowerCase()),
      requireWhitelist: next.requireWhitelist,
    };
  } catch (err) {
    return {
      ok: false,
      reason: `invalid amount: ${err instanceof Error ? err.message : String(err)}`,
    };
  }

  db.prepare(`UPDATE agents SET policy_json = ? WHERE id = ?`).run(
    JSON.stringify(storedPolicy),
    agentId,
  );
  return { ok: true };
}

// ────────────────────────────────────────────────────────────────────
// Tier evaluation
// ────────────────────────────────────────────────────────────────────

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
  const policy = resolvePolicy(input.agent);
  const reasons: string[] = [];
  let tier: Tier = "auto";

  if (input.amountWei > policy.guardPerCallAtomic) {
    tier = "human";
    reasons.push(
      `amount exceeds GUARD cap (max ${formatUnits(policy.guardPerCallAtomic, 6)} USDC)`,
    );
  } else if (input.amountWei > policy.autoPerCallAtomic) {
    tier = bump(tier, "guard");
    reasons.push(
      `amount exceeds AUTO cap (max ${formatUnits(policy.autoPerCallAtomic, 6)} USDC)`,
    );
  }

  // Whitelist
  if (
    policy.whitelist.length > 0 &&
    !policy.whitelist.includes(input.to.toLowerCase() as Address)
  ) {
    if (policy.requireWhitelist) {
      tier = "human";
      reasons.push(`recipient not on whitelist (requireWhitelist=true)`);
    } else {
      tier = bump(tier, "guard");
      reasons.push(`recipient not on whitelist`);
    }
  }

  // First-time recipient
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

  // Rolling 24h daily total
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
      /* skip non-numeric */
    }
  }
  if (dailyTotal + input.amountWei > policy.dailyAtomic) {
    tier = "human";
    reasons.push(
      `daily total ${formatUnits(dailyTotal + input.amountWei, 6)} would exceed cap (${formatUnits(policy.dailyAtomic, 6)} USDC)`,
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

// Legacy export for any place still importing POLICY
export const POLICY = {
  AUTO_PER_CALL_MAX: DEFAULT_POLICY.autoPerCallAtomic,
  GUARD_PER_CALL_MAX: DEFAULT_POLICY.guardPerCallAtomic,
  DAILY_MAX: DEFAULT_POLICY.dailyAtomic,
};
