import { Database } from "bun:sqlite";
import { env } from "./env";

export const db = new Database(env.DB_PATH, { create: true });
db.exec("PRAGMA journal_mode = WAL");

db.exec(`
  CREATE TABLE IF NOT EXISTS agents (
    id                          TEXT PRIMARY KEY,
    name                        TEXT NOT NULL,
    chain                       TEXT NOT NULL,
    smart_account_address       TEXT NOT NULL,
    owner_address               TEXT NOT NULL,
    agent_session_pubkey        TEXT NOT NULL,
    agent_session_privkey       TEXT NOT NULL,
    -- Serialized permission account blob produced by ZeroDev's
    -- serializePermissionAccount(). Contains everything needed to
    -- reconstruct a session-key-signed kernel client without the
    -- owner's private key.
    permission_account_blob     TEXT,
    init_tx_hash                TEXT,
    status                      TEXT NOT NULL,
    created_at                  INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS api_keys (
    key         TEXT PRIMARY KEY,
    agent_id    TEXT NOT NULL,
    created_at  INTEGER NOT NULL,
    revoked_at  INTEGER,
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );

  CREATE INDEX IF NOT EXISTS idx_api_keys_agent_id ON api_keys(agent_id);
`);

export type AgentRow = {
  id: string;
  name: string;
  chain: string;
  smart_account_address: string;
  owner_address: string;
  agent_session_pubkey: string;
  agent_session_privkey: string;
  permission_account_blob: string | null;
  init_tx_hash: string | null;
  status: "provisioning" | "active" | "failed";
  created_at: number;
};

export type ApiKeyRow = {
  key: string;
  agent_id: string;
  created_at: number;
  revoked_at: number | null;
};
