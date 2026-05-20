import { randomUUID } from "crypto";
import { db, type TxLogRow } from "../db";

export type LogActivityInput = {
  agentId: string;
  kind: TxLogRow["kind"];
  tier: TxLogRow["tier"];
  status: TxLogRow["status"];
  target?: string;
  token?: string;
  amount?: string;
  userOpHash?: string;
  txHash?: string;
  error?: string;
  /** Detection verdicts serialized as JSON string. */
  detection?: string;
  /** Comma-separated list of guard layers that escalated this row. */
  triggeredBy?: string;
};

export function logActivity(input: LogActivityInput): TxLogRow {
  const id = randomUUID();
  const now = Date.now();
  db.prepare(
    `INSERT INTO tx_log (id, agent_id, kind, tier, status, target, token,
                         amount, user_op_hash, tx_hash, error, detection,
                         triggered_by, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.agentId,
    input.kind,
    input.tier,
    input.status,
    input.target ?? null,
    input.token ?? null,
    input.amount ?? null,
    input.userOpHash ?? null,
    input.txHash ?? null,
    input.error ?? null,
    input.detection ?? null,
    input.triggeredBy ?? null,
    now,
  );
  return {
    id,
    agent_id: input.agentId,
    kind: input.kind,
    tier: input.tier,
    status: input.status,
    target: input.target ?? null,
    token: input.token ?? null,
    amount: input.amount ?? null,
    user_op_hash: input.userOpHash ?? null,
    tx_hash: input.txHash ?? null,
    error: input.error ?? null,
    detection: input.detection ?? null,
    triggered_by: input.triggeredBy ?? null,
    created_at: now,
  };
}

export function listActivity(opts?: {
  agentId?: string;
  limit?: number;
}): TxLogRow[] {
  const limit = Math.min(opts?.limit ?? 50, 200);
  if (opts?.agentId) {
    return db
      .prepare(
        `SELECT * FROM tx_log WHERE agent_id = ?
         ORDER BY created_at DESC LIMIT ?`,
      )
      .all(opts.agentId, limit) as TxLogRow[];
  }
  return db
    .prepare(`SELECT * FROM tx_log ORDER BY created_at DESC LIMIT ?`)
    .all(limit) as TxLogRow[];
}
