import { randomBytes, randomUUID } from "crypto";
import { db, type AgentRow } from "../db";
import { provisionAgent } from "./kernel";

export type CreateAgentInput = {
  name: string;
};

export type CreateAgentResult = {
  agent: {
    id: string;
    name: string;
    chain: string;
    smartAccountAddress: string;
    ownerAddress: string;
    agentSessionAddress: string;
    initTxHash: string | null;
    status: AgentRow["status"];
    createdAt: number;
  };
  apiKey: string;
};

/**
 * Create a new Agent end-to-end:
 *   1. Insert a `provisioning` row up-front so we have an id to log against
 *   2. Provision the smart account + Agent session key on-chain
 *   3. Mint an API key tied to the Agent
 *   4. Flip status to `active`
 *
 * Failures mid-way leave the row in `provisioning` for inspection.
 */
export async function createAgent(
  input: CreateAgentInput,
): Promise<CreateAgentResult> {
  const id = randomUUID();
  const now = Date.now();

  db.prepare(
    `INSERT INTO agents (id, name, chain, smart_account_address, owner_address,
                         agent_session_pubkey, agent_session_privkey,
                         init_tx_hash, status, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    "base-sepolia",
    "", // smart_account_address — filled after on-chain provisioning
    "",
    "",
    "",
    null,
    "provisioning",
    now,
  );

  const result = await provisionAgent();

  db.prepare(
    `UPDATE agents SET
       smart_account_address = ?,
       owner_address = ?,
       agent_session_pubkey = ?,
       agent_session_privkey = ?,
       init_tx_hash = ?,
       status = 'active'
     WHERE id = ?`,
  ).run(
    result.smartAccountAddress,
    result.ownerAddress,
    result.agentSessionAddress,
    result.agentSessionPrivateKey,
    result.initTxHash,
    id,
  );

  const apiKey = `ag_test_${randomBytes(24).toString("hex")}`;
  db.prepare(
    `INSERT INTO api_keys (key, agent_id, created_at) VALUES (?, ?, ?)`,
  ).run(apiKey, id, now);

  return {
    agent: {
      id,
      name: input.name,
      chain: "base-sepolia",
      smartAccountAddress: result.smartAccountAddress,
      ownerAddress: result.ownerAddress,
      agentSessionAddress: result.agentSessionAddress,
      initTxHash: result.initTxHash,
      status: "active",
      createdAt: now,
    },
    apiKey,
  };
}

export function getAgentByApiKey(apiKey: string): AgentRow | null {
  const row = db
    .prepare(
      `SELECT a.* FROM agents a
       INNER JOIN api_keys k ON k.agent_id = a.id
       WHERE k.key = ? AND k.revoked_at IS NULL`,
    )
    .get(apiKey) as AgentRow | undefined;
  return row ?? null;
}

export function listAgents() {
  return db
    .prepare(
      `SELECT id, name, chain, smart_account_address, owner_address,
              agent_session_pubkey, init_tx_hash, status, created_at
       FROM agents
       ORDER BY created_at DESC`,
    )
    .all();
}
