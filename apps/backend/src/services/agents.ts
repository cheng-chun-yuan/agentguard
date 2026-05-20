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
       permission_account_blob = ?,
       init_tx_hash = ?,
       status = 'active'
     WHERE id = ?`,
  ).run(
    result.smartAccountAddress,
    result.ownerAddress,
    result.agentSessionAddress,
    result.agentSessionPrivateKey,
    result.permissionAccountBlob,
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

export type RegisterAgentInput = {
  name: string;
  smartAccountAddress: string;
  ownerAddress: string;
  agentSessionPubkey: string;
  agentSessionPrivkey: string;
  permissionAccountBlob: string;
  initTxHash: string;
  /** USDC atomic units (6 decimals). Stored for display on the policy panel. */
  onChainCapAtomic?: string;
};

/**
 * Register an Agent that was provisioned client-side (by the dashboard,
 * via the user's Privy embedded wallet). The backend never sees the
 * owner's private key — only the smart-account address and the agent
 * session key it'll use for signing transfers on the user's behalf.
 */
export function registerAgent(input: RegisterAgentInput): CreateAgentResult {
  const id = randomUUID();
  const now = Date.now();

  db.prepare(
    `INSERT INTO agents (id, name, chain, smart_account_address, owner_address,
                         agent_session_pubkey, agent_session_privkey,
                         permission_account_blob, init_tx_hash, status,
                         on_chain_cap_atomic, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.name,
    "base-sepolia",
    input.smartAccountAddress,
    input.ownerAddress,
    input.agentSessionPubkey,
    input.agentSessionPrivkey,
    input.permissionAccountBlob,
    input.initTxHash,
    "active",
    input.onChainCapAtomic ?? null,
    now,
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
      smartAccountAddress: input.smartAccountAddress,
      ownerAddress: input.ownerAddress,
      agentSessionAddress: input.agentSessionPubkey,
      initTxHash: input.initTxHash,
      status: "active",
      createdAt: now,
    },
    apiKey,
  };
}
