import { Elysia } from "elysia";
import { cors } from "@elysiajs/cors";
import { env } from "./env";
import { agentsRoute } from "./routes/agents";
import { executeRoute } from "./routes/execute";
import { activityRoute } from "./routes/activity";
import { approvalsRoute } from "./routes/approvals";
import { policyRoute } from "./routes/policy";
import { AuthError } from "./middleware/auth";

const app = new Elysia()
  .use(
    cors({
      origin: [
        env.DASHBOARD_ORIGIN,
        "http://localhost:4000",
        "https://agentguard.polyoctant.com",
        "https://api-agentguard.polyoctant.com",
        "https://agentguard-dashboard-seven.vercel.app",
        // Vercel preview deployments — match `*-<hash>.vercel.app`
        /^https:\/\/agentguard-dashboard.*\.vercel\.app$/,
      ],
      credentials: true,
    }),
  )
  .onError(({ error, code, set }) => {
    const message = error instanceof Error ? error.message : String(error);
    if (error instanceof AuthError) {
      set.status = error.status;
      return { error: message };
    }
    console.error(`[${code}]`, message);
    set.status = code === "VALIDATION" ? 400 : 500;
    return { error: message };
  })
  .get("/health", () => ({ ok: true, service: "agentguard-backend" }))
  .use(agentsRoute)
  .use(executeRoute)
  .use(activityRoute)
  .use(approvalsRoute)
  .use(policyRoute)
  .listen(env.PORT);

console.log(
  `🛡️  AgentGuard backend listening on http://localhost:${env.PORT}`,
);
console.log(`   POST /agents          create + provision a new Agent`);
console.log(`   GET  /agents          list all Agents`);
console.log(`   POST /transfer        execute USDC transfer (auth: Bearer apiKey)`);
console.log(`   GET  /health          liveness check`);

export type App = typeof app;
