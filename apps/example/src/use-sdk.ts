/**
 * AgentGuard SDK smoke test — proves the full E2E path:
 *
 *   1. Create a new Agent via backend HTTP API → get API key + smart account
 *   2. Initialize the SDK with the API key
 *   3. Call guard.transfer(...) → SDK posts to backend → backend signs UserOp
 *      with stored Agent session key → bundler submits → on-chain receipt
 *
 * Run with:
 *   cd apps/example && bun run smoke
 */

import { AgentGuard, AgentGuardError } from "@agentguard/sdk";

const BACKEND_URL = process.env.AGENTGUARD_URL ?? "http://localhost:3737";
const RECIPIENT = (process.env.RECIPIENT ??
  "0x000000000000000000000000000000000000dEaD") as `0x${string}`;

const log = {
  step: (n: number, msg: string) =>
    console.log(`\n${"─".repeat(60)}\nStep ${n}: ${msg}\n${"─".repeat(60)}`),
  info: (msg: string) => console.log(`   ${msg}`),
  ok: (msg: string) => console.log(`   ✓ ${msg}`),
};

async function main() {
  console.log("\n🛡️  AgentGuard SDK smoke test\n");

  // ── Step 1: Provision an Agent (skipped if AGENTGUARD_API_KEY is set) ──
  let apiKey = process.env.AGENTGUARD_API_KEY;
  let smartAccount: string | undefined;

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
    smartAccount = data.agent.smartAccountAddress;
    log.info(`API key:        ${apiKey}`);
    log.info(`Smart account:  ${smartAccount}`);
    log.info(`Init tx:        ${data.agent.initTxHash}`);
    log.ok("Agent active");
  } else {
    log.step(1, "Using existing API key from env");
    log.info(`API key: ${apiKey}`);
  }

  // ── Step 2: Initialize SDK ──
  log.step(2, "Initialize SDK");
  const guard = new AgentGuard({ apiKey, baseUrl: BACKEND_URL });
  log.ok("SDK ready");

  // ── Step 3: Transfer (in-policy, < 0.01 USDC cap) ──
  log.step(3, "guard.transfer({ token: 'USDC', amount: '0.001', ... })");
  log.info(`Recipient: ${RECIPIENT}`);

  try {
    const result = await guard.transfer({
      to: RECIPIENT,
      token: "USDC",
      amount: "0.001",
    });
    log.ok(`Status:    ${result.status}`);
    log.ok(`UserOp:    ${result.userOpHash}`);
    log.ok(`Tx hash:   ${result.txHash}`);
    log.info(
      `Explorer:  https://sepolia.basescan.org/tx/${result.txHash}`,
    );
  } catch (err) {
    if (err instanceof AgentGuardError) {
      console.error(`\n💥 AgentGuardError (${err.status}): ${err.message}`);
    } else {
      console.error("\n💥", err);
    }
    process.exit(1);
  }

  // ── Step 4: Verify the out-of-policy path still rejects ──
  log.step(4, "Try 1 USDC transfer (over 0.01 cap — should reject)");
  try {
    await guard.transfer({ to: RECIPIENT, token: "USDC", amount: "1" });
    console.error("   ✗ Out-of-policy transfer was accepted — FAIL");
    process.exit(1);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.ok(`Rejected as expected: ${msg.split("\n")[0].slice(0, 100)}`);
  }

  console.log("\n" + "═".repeat(60));
  console.log("✅ SDK smoke test passed — M1.3 complete");
  console.log("═".repeat(60));
}

main().catch((err) => {
  console.error("\n💥 Smoke test crashed:", err);
  process.exit(1);
});
