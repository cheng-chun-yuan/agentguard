import { Elysia, t } from "elysia";
import { listActivity } from "../services/activity";

export const activityRoute = new Elysia({ prefix: "/activity" }).get(
  "/",
  ({ query }) =>
    listActivity({
      agentId: query.agentId,
      limit: query.limit ? Number(query.limit) : undefined,
    }),
  {
    query: t.Object({
      agentId: t.Optional(t.String()),
      limit: t.Optional(t.String()),
    }),
  },
);
