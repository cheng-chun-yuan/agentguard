import { getAgentByApiKey } from "../services/agents";
import type { AgentRow } from "../db";

export class AuthError extends Error {
  status = 401;
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

/**
 * Resolve the calling Agent from a `Authorization: Bearer <apiKey>` header.
 * Throws AuthError if the header is missing, malformed, or the key is unknown.
 */
export function requireAgent(
  headers: Record<string, string | undefined>,
): AgentRow {
  const auth = headers.authorization ?? headers.Authorization;
  if (!auth || !/^bearer\s+/i.test(auth)) {
    throw new AuthError(
      "Missing or malformed Authorization header (expected: Bearer <apiKey>)",
    );
  }
  const apiKey = auth.replace(/^bearer\s+/i, "").trim();
  const agent = getAgentByApiKey(apiKey);
  if (!agent) throw new AuthError("Invalid API key");
  if (agent.status !== "active")
    throw new AuthError(`Agent is not active (status: ${agent.status})`);
  return agent;
}
