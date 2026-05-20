import { Elysia, t } from "elysia";
import { createAgent, listAgents, registerAgent } from "../services/agents";

export const agentsRoute = new Elysia({ prefix: "/agents" })
  // Headless / smoke-test path — backend provisions using the shared dev
  // owner. Used by apps/example. Will be retired once Privy is the only
  // provisioning path.
  .post(
    "/",
    async ({ body }) => createAgent({ name: body.name }),
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 64 }),
      }),
    },
  )
  // Client-provisioned path — dashboard runs the 7702 + plugin install in
  // the browser using the user's Privy wallet, then POSTs the resulting
  // addresses + agent session key here.
  .post(
    "/register",
    ({ body }) =>
      registerAgent({
        name: body.name,
        smartAccountAddress: body.smartAccountAddress,
        ownerAddress: body.ownerAddress,
        agentSessionPubkey: body.agentSessionPubkey,
        agentSessionPrivkey: body.agentSessionPrivkey,
        permissionAccountBlob: body.permissionAccountBlob,
        initTxHash: body.initTxHash,
        onChainCapAtomic: body.onChainCapAtomic,
      }),
    {
      body: t.Object({
        name: t.String({ minLength: 1, maxLength: 64 }),
        smartAccountAddress: t.String({ pattern: "^0x[a-fA-F0-9]{40}$" }),
        ownerAddress: t.String({ pattern: "^0x[a-fA-F0-9]{40}$" }),
        agentSessionPubkey: t.String({ pattern: "^0x[a-fA-F0-9]{40}$" }),
        agentSessionPrivkey: t.String({ pattern: "^0x[a-fA-F0-9]{64}$" }),
        permissionAccountBlob: t.String({ minLength: 16 }),
        initTxHash: t.String({ pattern: "^0x[a-fA-F0-9]{64}$" }),
        onChainCapAtomic: t.Optional(t.String({ pattern: "^[0-9]+$" })),
      }),
    },
  )
  .get("/", () => listAgents());
