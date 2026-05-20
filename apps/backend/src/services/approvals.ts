import { db, type TxLogRow } from "../db";

/**
 * Approvals are encoded as tx_log rows with status='pending_approval'.
 * The owner (via the dashboard) signs and submits a UserOp themselves —
 * backend only updates the row to reflect the decision + on-chain result.
 */

export function getApproval(id: string): TxLogRow | null {
  const row = db
    .prepare(`SELECT * FROM tx_log WHERE id = ?`)
    .get(id) as TxLogRow | undefined;
  return row ?? null;
}

export function listPendingApprovals(agentId: string): TxLogRow[] {
  return db
    .prepare(
      `SELECT * FROM tx_log
       WHERE agent_id = ? AND status = 'pending_approval'
       ORDER BY created_at DESC`,
    )
    .all(agentId) as TxLogRow[];
}

export function approveApproval(opts: {
  id: string;
  txHash: string;
  userOpHash?: string;
}): { ok: boolean; reason?: string } {
  const row = getApproval(opts.id);
  if (!row) return { ok: false, reason: "approval not found" };
  if (row.status !== "pending_approval")
    return { ok: false, reason: `not pending (status: ${row.status})` };

  db.prepare(
    `UPDATE tx_log
       SET status = 'submitted',
           tx_hash = ?,
           user_op_hash = COALESCE(?, user_op_hash),
           error = NULL
     WHERE id = ?`,
  ).run(opts.txHash, opts.userOpHash ?? null, opts.id);
  return { ok: true };
}

export function rejectApproval(opts: {
  id: string;
  reason?: string;
}): { ok: boolean; reason?: string } {
  const row = getApproval(opts.id);
  if (!row) return { ok: false, reason: "approval not found" };
  if (row.status !== "pending_approval")
    return { ok: false, reason: `not pending (status: ${row.status})` };

  db.prepare(
    `UPDATE tx_log
       SET status = 'rejected',
           error = ?
     WHERE id = ?`,
  ).run(opts.reason ?? "rejected by owner", opts.id);
  return { ok: true };
}
