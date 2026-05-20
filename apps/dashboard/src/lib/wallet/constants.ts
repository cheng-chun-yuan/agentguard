/**
 * Wallet constants — duplicated from apps/backend/src/services/kernel.ts.
 *
 * For hackathon speed, we duplicate ~30 lines of constants here rather than
 * extracting to a shared workspace package. Once architecture stabilizes,
 * this should move to `packages/wallet-core` and both apps consume it.
 */

import { parseUnits, type Address } from "viem";
import { baseSepolia } from "viem/chains";
import { KERNEL_V3_3, getEntryPoint } from "@zerodev/sdk/constants";

export const chain = baseSepolia;
export const entryPoint = getEntryPoint("0.7");
export const kernelVersion = KERNEL_V3_3;

// Base Sepolia testnet USDC
export const USDC_ADDRESS: Address =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e";

export const ERC20_TRANSFER_ABI = [
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

// Tier 1 Agent session key per-call cap (must match backend)
export const AGENT_SESSION_PER_CALL_CAP = parseUnits("0.01", 6);
