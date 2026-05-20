import { Elysia, t } from "elysia";
import { requireAgent } from "../middleware/auth";
import { executeTransfer } from "../services/execute";
import type { Address } from "viem";

export const executeRoute = new Elysia().post(
  "/transfer",
  async ({ headers, body }) => {
    const agent = requireAgent(headers);
    return executeTransfer({
      agent,
      to: body.to as Address,
      token: body.token,
      amount: body.amount,
    });
  },
  {
    body: t.Object({
      to: t.String({ pattern: "^0x[a-fA-F0-9]{40}$" }),
      token: t.String({ minLength: 1, maxLength: 16 }),
      amount: t.String({ pattern: "^[0-9]+(\\.[0-9]+)?$" }),
    }),
  },
);
