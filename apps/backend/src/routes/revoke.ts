import { Elysia, t } from "elysia";
import { db, type AgentRow } from "../db";
import { logActivity } from "../services/activity";

/**
 * Emergency Stop — agent is marked revoked, future /transfer calls reject
 * immediately. The dashboard ALSO sweeps any remaining USDC from the
 * smart account in a single owner-signed UserOp (handled client-side, the
 * sweep tx hash is passed in here for the activity log entry).
 *
 * The on-chain session key is NOT explicitly uninstalled today — that
 * requires a Kernel `uninstallValidation` UserOp which is the M5++
 * roadmap item. Until then, the natural-expiry + rate-limit policies on
 * the validator are the on-chain backstop; sweeping the account makes
 * the key useless even before expiry.
 */
export const revokeRoute = new Elysia({ prefix: "/agents" }).post(
  "/:id/revoke",
  ({ params, body, set }) => {
    const row = db
      .prepare(`SELECT * FROM agents WHERE id = ?`)
      .get(params.id) as AgentRow | undefined;
    if (!row) {
      set.status = 404;
      return { error: "agent not found" };
    }
    if (row.status === "revoked") {
      set.status = 409;
      return { error: "agent already revoked" };
    }

    db.prepare(`UPDATE agents SET status = 'revoked' WHERE id = ?`).run(
      params.id,
    );

    // Append an activity row so the timeline shows the revoke explicitly.
    logActivity({
      agentId: params.id,
      kind: "transfer",
      tier: "human",
      status: body?.sweepTxHash ? "submitted" : "rejected",
      target: row.owner_address,
      token: "USDC",
      amount: body?.sweptAmount ?? "0",
      userOpHash: body?.userOpHash,
      txHash: body?.sweepTxHash,
      error: body?.reason ?? "EMERGENCY STOP — agent revoked",
      triggeredBy: "policy",
    });

    return { ok: true, agentId: params.id, status: "revoked" };
  },
  {
    params: t.Object({ id: t.String() }),
    body: t.Optional(
      t.Object({
        sweepTxHash: t.Optional(t.String({ pattern: "^0x[a-fA-F0-9]{64}$" })),
        userOpHash: t.Optional(t.String({ pattern: "^0x[a-fA-F0-9]{64}$" })),
        sweptAmount: t.Optional(t.String()),
        reason: t.Optional(t.String({ maxLength: 200 })),
      }),
    ),
  },
);
