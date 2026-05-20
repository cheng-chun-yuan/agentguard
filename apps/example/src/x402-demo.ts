/**
 * x402 fast-path demo — Agent transparently pays for a paywalled API.
 *
 *   1. Start a mock x402 resource server on :4242 (in-process)
 *   2. Initialize the AgentGuard SDK
 *   3. Call guard.fetch('/forecast') in a loop
 *      - first call → 402, SDK auto-pays (session key), retries → 200
 *      - subsequent calls → same flow, each a fresh on-chain micropayment
 *
 * Run with:
 *   cd apps/example
 *   AGENTGUARD_API_KEY=ag_test_... AGENTGUARD_URL=http://localhost:3737 \
 *     bun run x402
 */

import { AgentGuard, AgentGuardError } from "@agentguard/sdk";
import { startServer } from "./x402-server";

const BACKEND_URL = process.env.AGENTGUARD_URL ?? "http://localhost:3737";
const RUNS = Number(process.env.X402_RUNS ?? 3);

async function main() {
  const apiKey = process.env.AGENTGUARD_API_KEY;
  if (!apiKey) {
    throw new Error(
      "Set AGENTGUARD_API_KEY (mint one via the dashboard or POST /agents).",
    );
  }

  console.log("\n🌤️  AgentGuard × x402 fast-path demo\n");

  const server = startServer();
  const endpoint = `http://localhost:${server.port}/forecast`;
  console.log(`server   → ${endpoint}`);
  console.log(`backend  → ${BACKEND_URL}`);
  console.log(`api key  → ${apiKey.slice(0, 16)}…\n`);

  const guard = new AgentGuard({ apiKey, baseUrl: BACKEND_URL });

  let ok = 0;
  let totalMs = 0;

  for (let i = 1; i <= RUNS; i++) {
    const t0 = Date.now();
    try {
      const res = await guard.fetch(endpoint);
      const elapsed = Date.now() - t0;
      totalMs += elapsed;

      if (res.ok) {
        const data = (await res.json()) as {
          forecast: string;
          paidWith: string;
        };
        console.log(
          `[${i}/${RUNS}]  ${elapsed.toString().padStart(5)} ms  · ${data.forecast.padEnd(24)} · tx ${data.paidWith.slice(0, 10)}…`,
        );
        ok++;
      } else {
        console.log(`[${i}/${RUNS}]  ${res.status} ${res.statusText}`);
      }
    } catch (err) {
      if (err instanceof AgentGuardError) {
        console.log(`[${i}/${RUNS}]  ✗ AgentGuardError ${err.status}: ${err.message}`);
      } else {
        throw err;
      }
    }
  }

  server.stop();

  console.log(
    `\n${"═".repeat(60)}\n${ok}/${RUNS} forecasts paid for — avg ${(totalMs / Math.max(ok, 1)).toFixed(0)} ms (incl. on-chain settlement)\n${"═".repeat(60)}`,
  );
}

main().catch((err) => {
  console.error("\n💥 demo crashed:", err);
  process.exit(1);
});
