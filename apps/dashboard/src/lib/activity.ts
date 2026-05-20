import { getBackendUrl } from "./wallet/clients";

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
  created_at: number;
};

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
