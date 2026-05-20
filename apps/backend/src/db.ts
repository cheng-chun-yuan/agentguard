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

  CREATE TABLE IF NOT EXISTS tx_log (
    id           TEXT PRIMARY KEY,
    agent_id     TEXT NOT NULL,
    kind         TEXT NOT NULL,        -- 'transfer' for now
    tier         TEXT NOT NULL,        -- 'auto' | 'guard' | 'human'
    status       TEXT NOT NULL,        -- 'submitted' | 'rejected' | 'pending_approval'
    target       TEXT,                 -- recipient address
    token        TEXT,
    amount       TEXT,                 -- human-readable (e.g. "0.001")
    user_op_hash TEXT,
    tx_hash      TEXT,
    error        TEXT,
    -- JSON blob of detection results from the providers registry.
    detection    TEXT,
    created_at   INTEGER NOT NULL,
    FOREIGN KEY (agent_id) REFERENCES agents(id)
  );

  CREATE INDEX IF NOT EXISTS idx_tx_log_agent_id ON tx_log(agent_id);
  CREATE INDEX IF NOT EXISTS idx_tx_log_created_at ON tx_log(created_at DESC);
`);

// Idempotent migrations for columns added after the initial schema.
// SQLite ALTER TABLE ADD COLUMN is the only DDL safely callable on a
// running DB — try/catch swallows the "duplicate column" error on second
// run.
const migrations: { name: string; sql: string }[] = [
  { name: "tx_log.detection", sql: `ALTER TABLE tx_log ADD COLUMN detection TEXT` },
];
for (const m of migrations) {
  try {
    db.exec(m.sql);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    if (!msg.includes("duplicate column")) {
      console.warn(`[db] migration "${m.name}" skipped: ${msg}`);
    }
  }
}

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

export type TxLogRow = {
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
  detection: string | null;
  created_at: number;
};
