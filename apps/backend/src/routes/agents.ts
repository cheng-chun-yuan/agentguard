import { Elysia, t } from "elysia";
import { createAgent, listAgents } from "../services/agents";

export const agentsRoute = new Elysia({ prefix: "/agents" })
  .post(
    "/",
    async ({ body }) => {
      const result = await createAgent({ name: body.name });
      return result;
    },
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 64 }),
      }),
    },
  )
  .get("/", () => listAgents());
