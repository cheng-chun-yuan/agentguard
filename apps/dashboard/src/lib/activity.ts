import { getBackendUrl } from "./wallet/clients";

export type DetectionVerdict = "safe" | "suspicious" | "hostile";

export type DetectionResultJson = {
  worst: DetectionVerdict;
  results: {
    provider: string;
    verdict: DetectionVerdict;
    score: number;
    reasons: string[];
    latencyMs: number;
  }[];
};

export type TxLogEntry = {
  id: string;
  agent_id: string;
  kind: "transfer";
  tier: "auto" | "guard" | "human";
  status: "submitted" | "rejected" | "pending_approval";
  target: string | null;
  token: string | null;
  amount: string | null;
  user_op_hash: string | null;
  tx_hash: string | null;
  error: string | null;
  /** JSON-encoded DetectionResultJson, or null if no detection ran. */
  detection: string | null;
  /** Comma-separated guard layers that escalated the row, e.g. "policy,agent".
   *  Null for AUTO rows. */
  triggered_by: string | null;
  created_at: number;
};

export type GuardSource = "policy" | "agent";

/** Parse `triggered_by` into a deduped, ordered array. */
export function parseSources(raw: string | null): GuardSource[] {
  if (!raw) return [];
  const out: GuardSource[] = [];
  for (const tok of raw.split(",")) {
    const t = tok.trim();
    if ((t === "policy" || t === "agent") && !out.includes(t)) out.push(t);
  }
  return out;
}

export function parseDetection(
  raw: string | null,
): DetectionResultJson | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as DetectionResultJson;
  } catch {
    return null;
  }
}

export async function fetchActivity(agentId: string): Promise<TxLogEntry[]> {
  const res = await fetch(
    `${getBackendUrl()}/activity?agentId=${encodeURIComponent(agentId)}&limit=20`,
  );
  if (!res.ok) throw new Error(`Activity fetch failed (${res.status})`);
  return (await res.json()) as TxLogEntry[];
}

export type AgentListEntry = {
  id: string;
  name: string;
  chain: string;
  smart_account_address: string;
  owner_address: string;
  agent_session_pubkey: string;
  init_tx_hash: string | null;
  status: string;
  created_at: number;
};

export async function fetchAgentsForOwner(
  ownerAddress: string,
): Promise<AgentListEntry[]> {
  const res = await fetch(`${getBackendUrl()}/agents`);
  if (!res.ok) throw new Error(`Agents fetch failed (${res.status})`);
  const all = (await res.json()) as AgentListEntry[];
  return all.filter(
    (a) => a.owner_address.toLowerCase() === ownerAddress.toLowerCase(),
  );
}

export async function approveApprovalApi(
  id: string,
  txHash: string,
  userOpHash?: string,
): Promise<void> {
  const res = await fetch(`${getBackendUrl()}/approvals/${id}/approve`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ txHash, userOpHash }),
  });
  if (!res.ok)
    throw new Error(`approve failed (${res.status}): ${await res.text()}`);
}

export async function rejectApprovalApi(
  id: string,
  reason?: string,
): Promise<void> {
  const res = await fetch(`${getBackendUrl()}/approvals/${id}/reject`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(reason ? { reason } : {}),
  });
  if (!res.ok)
    throw new Error(`reject failed (${res.status}): ${await res.text()}`);
}
