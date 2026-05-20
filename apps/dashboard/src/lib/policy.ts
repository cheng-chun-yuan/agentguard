import { getBackendUrl } from "./wallet/clients";

export type AgentPolicy = {
  agentId: string;
  /** On-chain validator cap (hard limit, requires rotation to change). */
  onChainCapUsdc: string | null;
  /** Soft caps — editable, hot-applied. */
  autoPerCallUsdc: string;
  guardPerCallUsdc: string;
  dailyUsdc: string;
  whitelist: string[];
  requireWhitelist: boolean;
};

export type PolicyPatch = Partial<
  Pick<
    AgentPolicy,
    | "autoPerCallUsdc"
    | "guardPerCallUsdc"
    | "dailyUsdc"
    | "whitelist"
    | "requireWhitelist"
  >
>;

export async function fetchPolicy(apiKey: string): Promise<AgentPolicy> {
  const res = await fetch(`${getBackendUrl()}/policy`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  });
  if (!res.ok)
    throw new Error(`fetchPolicy failed (${res.status}): ${await res.text()}`);
  return (await res.json()) as AgentPolicy;
}

export async function patchPolicy(
  apiKey: string,
  patch: PolicyPatch,
): Promise<AgentPolicy> {
  const res = await fetch(`${getBackendUrl()}/policy`, {
    method: "PATCH",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(patch),
  });
  if (!res.ok)
    throw new Error(`patchPolicy failed (${res.status}): ${await res.text()}`);
  const data = (await res.json()) as { ok: true } & Omit<
    AgentPolicy,
    "onChainCapUsdc"
  >;
  return data as unknown as AgentPolicy;
}
