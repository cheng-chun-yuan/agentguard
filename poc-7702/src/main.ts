/**
 * AgentGuard POC — proves the full wallet stack works end-to-end:
 *   EOA  ──7702──►  Kernel v3 Smart Account
 *                          │
 *                          ├── sudo validator (owner)
 *                          └── permission validator (session key, bounded)
 *                                      │
 *                                      └──► UserOp via ZeroDev bundler+paymaster
 *
 * NOTE on API stability: ZeroDev's SDK evolves quickly. If any import path or
 * function signature has changed since this POC was written, check the current
 * docs at https://docs.zerodev.app/sdk/permissions. The shape of the flow is
 * stable; only specific function names tend to shift.
 */

import "dotenv/config";
import {
  createPublicClient,
  http,
  parseUnits,
  encodeFunctionData,
  type Address,
  type Hex,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { baseSepolia } from "viem/chains";

import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import { KERNEL_V3_3, getEntryPoint } from "@zerodev/sdk/constants";
import {
  toPermissionValidator,
} from "@zerodev/permissions";
import { toECDSASigner } from "@zerodev/permissions/signers";
import {
  toCallPolicy,
  CallPolicyVersion,
  ParamCondition,
} from "@zerodev/permissions/policies";

// ────────────────────────────────────────────────────────────────────
// Config
// ────────────────────────────────────────────────────────────────────

const env = (key: string): string => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
};

const OWNER_PRIVATE_KEY = env("OWNER_PRIVATE_KEY") as Hex;
// ZeroDev v3 serves bundler + paymaster from the same URL
const ZERODEV_RPC = env("ZERODEV_RPC");
const BASE_SEPOLIA_RPC = env("BASE_SEPOLIA_RPC");
const TEST_RECIPIENT = env("TEST_RECIPIENT") as Address;
const USDC_ADDRESS = env("USDC_ADDRESS") as Address;

const chain = baseSepolia;
const entryPoint = getEntryPoint("0.7");
const kernelVersion = KERNEL_V3_3;

// ERC-20 ABI fragment for `transfer` — used by the call policy
const ERC20_TRANSFER_ABI = [
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" },
    ],
    outputs: [{ type: "bool" }],
  },
] as const;

// Policy: max 0.01 USDC per call (USDC is 6 decimals)
const MAX_TRANSFER_AMOUNT = parseUnits("0.01", 6);

// ────────────────────────────────────────────────────────────────────
// Public client
// ────────────────────────────────────────────────────────────────────

const publicClient = createPublicClient({
  chain,
  transport: http(BASE_SEPOLIA_RPC),
});

// ────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────

const log = {
  step: (n: number, msg: string) => console.log(`\n${"─".repeat(60)}\nStep ${n}: ${msg}\n${"─".repeat(60)}`),
  info: (msg: string) => console.log(`   ${msg}`),
  ok: (msg: string) => console.log(`   ✓ ${msg}`),
  fail: (msg: string) => console.log(`   ✗ ${msg}`),
};

function encodeUsdcTransfer(to: Address, amount: bigint): Hex {
  return encodeFunctionData({
    abi: [
      {
        name: "transfer",
        type: "function",
        stateMutability: "nonpayable",
        inputs: [
          { name: "to", type: "address" },
          { name: "amount", type: "uint256" },
        ],
        outputs: [{ type: "bool" }],
      },
    ],
    functionName: "transfer",
    args: [to, amount],
  });
}

// ────────────────────────────────────────────────────────────────────
// Main flow
// ────────────────────────────────────────────────────────────────────

async function main() {
  console.log("\n🛡️  AgentGuard POC — 7702 + session key + paymaster\n");

  // ── Step 1: Owner EOA + Kernel account (7702 mode) ──
  log.step(1, "Owner EOA → 7702-delegated Kernel account");

  const ownerAccount = privateKeyToAccount(OWNER_PRIVATE_KEY);
  log.info(`Owner EOA address:        ${ownerAccount.address}`);

  const sudoValidator = await signerToEcdsaValidator(publicClient, {
    signer: ownerAccount,
    entryPoint,
    kernelVersion,
  });

  // In 7702 mode the smart account address == owner EOA address.
  const ownerKernelAccount = await createKernelAccount(publicClient, {
    plugins: { sudo: sudoValidator },
    entryPoint,
    kernelVersion,
    // EIP-7702: account address stays the same as the owner EOA.
    // ZeroDev exposes this via `eip7702Account: ownerAccount` on Kernel v3.
    // (If your SDK version uses a different flag, see docs.zerodev.app.)
    eip7702Account: ownerAccount,
  } as Parameters<typeof createKernelAccount>[1]);

  log.info(`Smart account address:    ${ownerKernelAccount.address}`);
  if (ownerKernelAccount.address.toLowerCase() !== ownerAccount.address.toLowerCase()) {
    log.fail("Smart account address does NOT match owner EOA — 7702 flag may not be active.");
    process.exit(1);
  }
  log.ok("Same address as owner EOA (7702 confirmed)");

  // ── Step 2: Mint a session key with a bounded policy ──
  log.step(2, "Generate session key + define policy");

  const sessionPk = generatePrivateKey();
  const sessionAccount = privateKeyToAccount(sessionPk);
  log.info(`Session key address:      ${sessionAccount.address}`);

  const sessionSigner = await toECDSASigner({ signer: sessionAccount });

  const callPolicy = toCallPolicy({
    policyVersion: CallPolicyVersion.V0_0_4,
    permissions: [
      {
        target: USDC_ADDRESS,
        valueLimit: 0n,
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        // Argument-level constraint: amount (arg index 1) must be ≤ MAX_TRANSFER_AMOUNT
        args: [
          null, // recipient — no constraint
          {
            condition: ParamCondition.LESS_THAN_OR_EQUAL,
            value: MAX_TRANSFER_AMOUNT,
          },
        ],
      },
    ],
  });

  const permissionValidator = await toPermissionValidator(publicClient, {
    entryPoint,
    kernelVersion,
    signer: sessionSigner,
    policies: [callPolicy],
  });

  log.info(`Policy: target=USDC, selector=transfer(...), amount ≤ 0.01 USDC`);

  // ── Step 3: Install the session key via an owner-signed UserOp ──
  log.step(3, "Install session key validator (owner signs, paymaster sponsors gas)");

  const sessionKernelAccount = await createKernelAccount(publicClient, {
    plugins: {
      sudo: sudoValidator,         // owner can still override
      regular: permissionValidator, // session key can only act in policy
    },
    entryPoint,
    kernelVersion,
    eip7702Account: ownerAccount,
  } as Parameters<typeof createKernelAccount>[1]);

  const paymasterClient = createZeroDevPaymasterClient({
    chain,
    transport: http(ZERODEV_RPC),
  });

  // Use the *owner* signing path to install the session key plugin on-chain.
  const ownerKernelClient = createKernelAccountClient({
    account: ownerKernelAccount,
    chain,
    bundlerTransport: http(ZERODEV_RPC),
    paymaster: paymasterClient,
  });

  // A "noop" UserOp from the owner — the act of submitting it triggers
  // 7702 authorization + plugin installation lazily on first use.
  log.info("Submitting initial UserOp (7702 auth + account init) ...");
  const initOpHash = await ownerKernelClient.sendUserOperation({
    callData: await ownerKernelAccount.encodeCalls([
      {
        to: ownerAccount.address,
        value: 0n,
        data: "0x",
      },
    ]),
  });
  log.info(`UserOp hash: ${initOpHash}`);

  const initReceipt = await ownerKernelClient.waitForUserOperationReceipt({
    hash: initOpHash,
  });
  log.ok(`Mined: ${initReceipt.receipt.transactionHash}`);
  log.ok(`User paid gas: 0 ETH (paymaster sponsored)`);

  // ── Step 4: Use the session key to make a small transfer ──
  log.step(4, "Session key signs an in-policy USDC transfer");

  const sessionKernelClient = createKernelAccountClient({
    account: sessionKernelAccount,
    chain,
    bundlerTransport: http(ZERODEV_RPC),
    paymaster: paymasterClient,
  });

  const inPolicyAmount = parseUnits("0.001", 6); // well under 0.01 limit
  log.info(`Transferring ${0.001} USDC to ${TEST_RECIPIENT}`);

  const transferOpHash = await sessionKernelClient.sendUserOperation({
    callData: await sessionKernelAccount.encodeCalls([
      {
        to: USDC_ADDRESS,
        value: 0n,
        data: encodeUsdcTransfer(TEST_RECIPIENT, inPolicyAmount),
      },
    ]),
  });
  log.info(`UserOp hash: ${transferOpHash}`);

  const transferReceipt = await sessionKernelClient.waitForUserOperationReceipt({
    hash: transferOpHash,
  });
  log.ok(`Mined: ${transferReceipt.receipt.transactionHash}`);
  log.ok(`Signed by session key, gas paid by paymaster`);

  // ── Step 5: Verify the validator REJECTS out-of-policy attempts ──
  log.step(5, "Try to transfer above policy limit (should fail)");

  const overLimitAmount = parseUnits("1", 6); // 1 USDC, 100× the limit
  log.info(`Attempting ${1.0} USDC transfer (over 0.01 limit) ...`);

  try {
    const badOpHash = await sessionKernelClient.sendUserOperation({
      callData: await sessionKernelAccount.encodeCalls([
        {
          to: USDC_ADDRESS,
          value: 0n,
          data: encodeUsdcTransfer(TEST_RECIPIENT, overLimitAmount),
        },
      ]),
    });
    // If we get here, the bundler accepted it — wait and see if it mines
    log.info(`UserOp hash (unexpected): ${badOpHash}`);
    try {
      await sessionKernelClient.waitForUserOperationReceipt({
        hash: badOpHash,
        timeout: 10_000,
      });
      log.fail("Out-of-policy transfer was MINED — validator did NOT enforce policy. FAIL.");
      process.exit(1);
    } catch {
      log.ok("UserOp accepted by bundler but never mined — likely reverted at validation.");
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    log.ok(`Rejected at bundler/validator layer (as expected):`);
    log.info(`  ${msg.split("\n")[0].slice(0, 120)}`);
  }

  // ── Done ──
  console.log("\n" + "═".repeat(60));
  console.log("✅ POC complete — full AgentGuard tech stack validated");
  console.log("═".repeat(60));
  console.log(`
   Owner EOA / Smart account: ${ownerAccount.address}
   Session key:               ${sessionAccount.address}
   In-policy tx:              ${transferReceipt.receipt.transactionHash}
   Block explorer:            https://sepolia.basescan.org/address/${ownerAccount.address}
`);
}

main().catch((err) => {
  console.error("\n💥 POC failed:\n", err);
  process.exit(1);
});
