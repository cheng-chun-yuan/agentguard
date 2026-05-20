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

// Kernel v3.3 implementation contract — the address an EOA delegates to via
// EIP-7702 authorization. Hardcoded here to avoid a private import; matches
// `KernelVersionToAddressesMap["0.3.3"].accountImplementationAddress` in
// @zerodev/sdk/_esm/constants.js.
export const KERNEL_V3_3_IMPLEMENTATION_ADDRESS: Address =
  "0xd6CEDDe84be40893d153Be9d467CD6aD37875b28";

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
