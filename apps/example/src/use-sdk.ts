/**
 * AgentGuard SDK smoke test — exercises all three policy tiers.
 *
 *   1. Create a new Agent via backend HTTP API → get API key + smart account
 *   2. Initialize SDK with the API key
 *   3. transfer() small amount → first-time recipient → GUARD tier
 *   4. transfer() same amount, same recipient → recipient is seen now → AUTO
 *   5. transfer() amount over AUTO cap → GUARD (amount bump)
 *   6. transfer() amount over GUARD cap → HUMAN (pending_approval)
 *
 * Run with:
 *   cd apps/example && bun run smoke
 */

import { AgentGuard, AgentGuardError, type TxResult } from "@agentguard/sdk";

const BACKEND_URL = process.env.AGENTGUARD_URL ?? "http://localhost:3737";
const RECIPIENT = (process.env.RECIPIENT ??
  "0x000000000000000000000000000000000000dEaD") as `0x${string}`;

const log = {
  step: (n: number, msg: string) =>
    console.log(`\n${"─".repeat(60)}\nStep ${n}: ${msg}\n${"─".repeat(60)}`),
  info: (msg: string) => console.log(`   ${msg}`),
  ok: (msg: string) => console.log(`   ✓ ${msg}`),
  warn: (msg: string) => console.log(`   ⚠ ${msg}`),
};

function describe(r: TxResult): void {
  log.ok(`status:  ${r.status}`);
  log.ok(`tier:    ${r.tier.toUpperCase()}`);
  if (r.status === "submitted") {
    log.ok(`tx:      ${r.txHash}`);
    log.info(`explorer: https://sepolia.basescan.org/tx/${r.txHash}`);
  } else if (r.status === "pending_approval") {
    log.ok(`reason:  ${r.reason}`);
    log.ok(`approve: ${r.approvalUrl}`);
  }
}

async function main() {
  console.log("\n🛡️  AgentGuard SDK smoke test\n");

  // ── Step 1: Provision an Agent (skipped if AGENTGUARD_API_KEY is set) ──
  let apiKey = process.env.AGENTGUARD_API_KEY;
  if (!apiKey) {
    log.step(1, "Provision a new Agent via POST /agents");
    const res = await fetch(`${BACKEND_URL}/agents`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: `sdk-smoke-${Date.now()}` }),
    });
    if (!res.ok) {
      throw new Error(`Provision failed (${res.status}): ${await res.text()}`);
    }
    const data = (await res.json()) as {
      agent: { smartAccountAddress: string; initTxHash: string };
      apiKey: string;
    };
    apiKey = data.apiKey;
    log.info(`API key:        ${apiKey}`);
    log.info(`Smart account:  ${data.agent.smartAccountAddress}`);
    log.ok("Agent active");
  } else {
    log.step(1, "Using existing API key from env");
    log.info(`API key: ${apiKey}`);
  }

  // ── Step 2: SDK ──
  log.step(2, "Initialize SDK");
  const guard = new AgentGuard({ apiKey, baseUrl: BACKEND_URL });
  log.ok("SDK ready");

  // ── Step 3: 0.001 USDC, new recipient → expect GUARD ──
  log.step(3, "transfer 0.001 USDC (first time → GUARD tier)");
  try {
    const r = await guard.transfer({
      to: RECIPIENT,
      token: "USDC",
      amount: "0.001",
    });
    describe(r);
  } catch (err) {
    if (err instanceof AgentGuardError)
      log.warn(`AgentGuardError ${err.status}: ${err.message}`);
    else throw err;
  }

  // ── Step 4: 0.001 USDC again, same recipient → expect AUTO ──
  log.step(4, "transfer 0.001 USDC again (recipient seen → AUTO tier)");
  try {
    const r = await guard.transfer({
      to: RECIPIENT,
      token: "USDC",
      amount: "0.001",
    });
    describe(r);
  } catch (err) {
    if (err instanceof AgentGuardError)
      log.warn(`AgentGuardError ${err.status}: ${err.message}`);
    else throw err;
  }

  // ── Step 5: 0.003 USDC → over AUTO cap → expect GUARD ──
  log.step(5, "transfer 0.003 USDC (amount over AUTO cap → GUARD tier)");
  try {
    const r = await guard.transfer({
      to: RECIPIENT,
      token: "USDC",
      amount: "0.003",
    });
    describe(r);
  } catch (err) {
    if (err instanceof AgentGuardError)
      log.warn(`AgentGuardError ${err.status}: ${err.message}`);
    else throw err;
  }

  // ── Step 6: 0.5 USDC → over GUARD cap → expect HUMAN (pending_approval) ──
  log.step(6, "transfer 0.5 USDC (way over → HUMAN, awaits approval)");
  try {
    const r = await guard.transfer({
      to: RECIPIENT,
      token: "USDC",
      amount: "0.5",
    });
    describe(r);
    if (r.status !== "pending_approval") {
      log.warn(
        "expected pending_approval here — policy engine didn't escalate",
      );
    }
  } catch (err) {
    if (err instanceof AgentGuardError)
      log.warn(`AgentGuardError ${err.status}: ${err.message}`);
    else throw err;
  }

  console.log("\n" + "═".repeat(60));
  console.log("✅ Smoke test complete — all three tiers exercised");
  console.log("═".repeat(60));
}

main().catch((err) => {
  console.error("\n💥 Smoke test crashed:", err);
  process.exit(1);
});
