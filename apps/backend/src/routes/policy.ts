import { Elysia, t } from "elysia";
import { requireAgent } from "../middleware/auth";
import { resolvePolicy, toHumanPolicy, updateAgentPolicy } from "../services/policy";
import { db, type AgentRow } from "../db";

/**
 * Per-agent policy CRUD. Auth: Bearer apiKey identifies the agent.
 *
 * GET  /policy           → current resolved (defaults merged with override)
 * PATCH /policy {...}    → update fields; hot-applied to next /transfer call
 */
export const policyRoute = new Elysia({ prefix: "/policy" })
  .get("/", ({ headers }) => {
    const agent = requireAgent(headers);
    return {
      agentId: agent.id,
      onChainCapUsdc: agent.on_chain_cap_atomic
        ? (Number(agent.on_chain_cap_atomic) / 1e6).toString()
        : null,
      ...toHumanPolicy(resolvePolicy(agent)),
    };
  })
  .patch(
    "/",
    ({ headers, body, set }) => {
      const agent = requireAgent(headers);
      const result = updateAgentPolicy(agent.id, body);
      if (!result.ok) {
        set.status = 400;
        return { error: result.reason };
      }
      const updated = db
        .prepare(`SELECT * FROM agents WHERE id = ?`)
        .get(agent.id) as AgentRow;
      return {
        ok: true,
        agentId: agent.id,
        ...toHumanPolicy(resolvePolicy(updated)),
      };
    },
    {
      body: t.Object({
        autoPerCallUsdc: t.Optional(
          t.String({ pattern: "^[0-9]+(\\.[0-9]+)?$" }),
        ),
        guardPerCallUsdc: t.Optional(
          t.String({ pattern: "^[0-9]+(\\.[0-9]+)?$" }),
        ),
        dailyUsdc: t.Optional(t.String({ pattern: "^[0-9]+(\\.[0-9]+)?$" })),
        whitelist: t.Optional(
          t.Array(t.String({ pattern: "^0x[a-fA-F0-9]{40}$" }), {
            maxItems: 50,
          }),
        ),
        requireWhitelist: t.Optional(t.Boolean()),
      }),
    },
  );
