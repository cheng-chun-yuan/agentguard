import { Elysia, t } from "elysia";
import {
  approveApproval,
  getApproval,
  listPendingApprovals,
  rejectApproval,
} from "../services/approvals";

export const approvalsRoute = new Elysia({ prefix: "/approvals" })
  .get(
    "/",
    ({ query, set }) => {
      if (!query.agentId) {
        set.status = 400;
        return { error: "agentId query parameter is required" };
      }
      return listPendingApprovals(query.agentId);
    },
    {
      query: t.Object({
        agentId: t.Optional(t.String()),
      }),
    },
  )
  .get(
    "/:id",
    ({ params, set }) => {
      const row = getApproval(params.id);
      if (!row) {
        set.status = 404;
        return { error: "approval not found" };
      }
      return row;
    },
    {
      params: t.Object({ id: t.String() }),
    },
  )
  .post(
    "/:id/approve",
    ({ params, body, set }) => {
      const result = approveApproval({
        id: params.id,
        txHash: body.txHash,
        userOpHash: body.userOpHash,
      });
      if (!result.ok) {
        set.status = 400;
        return { error: result.reason };
      }
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Object({
        txHash: t.String({ pattern: "^0x[a-fA-F0-9]{64}$" }),
        userOpHash: t.Optional(t.String({ pattern: "^0x[a-fA-F0-9]{64}$" })),
      }),
    },
  )
  .post(
    "/:id/reject",
    ({ params, body, set }) => {
      const result = rejectApproval({
        id: params.id,
        reason: body?.reason,
      });
      if (!result.ok) {
        set.status = 400;
        return { error: result.reason };
      }
      return { ok: true };
    },
    {
      params: t.Object({ id: t.String() }),
      body: t.Optional(
        t.Object({
          reason: t.Optional(t.String({ maxLength: 200 })),
        }),
      ),
    },
  );
