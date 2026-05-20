import {
  encodeFunctionData,
  parseUnits,
  type Address,
  type Hex,
} from "viem";
import { sessionClientFor, USDC_ADDRESS } from "./kernel";
import type { AgentRow } from "../db";

// USDC has 6 decimals on Base.
const TOKEN_REGISTRY: Record<string, { address: Address; decimals: number }> = {
  USDC: { address: USDC_ADDRESS, decimals: 6 },
};

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

export type TransferRequest = {
  agent: AgentRow;
  to: Address;
  token: string;
  amount: string; // human-readable, e.g. "0.001"
};

export type ExecuteResult = {
  status: "submitted";
  userOpHash: Hex;
  txHash: Hex;
};

/**
 * Tier-1 execution path: sign + send a UserOp using the Agent's session key.
 *
 * On-chain policy (installed at provisioning) caps single-transfer value;
 * out-of-policy requests revert at the validator stage. Tier 2/3 routing
 * (Guard review + human approval) will be added in M2.
 */
export async function executeTransfer(
  req: TransferRequest,
): Promise<ExecuteResult> {
  const token = TOKEN_REGISTRY[req.token.toUpperCase()];
  if (!token) {
    throw new Error(
      `Unsupported token: ${req.token}. Supported: ${Object.keys(TOKEN_REGISTRY).join(", ")}`,
    );
  }

  const amountWei = parseUnits(req.amount, token.decimals);

  if (!req.agent.permission_account_blob) {
    throw new Error(
      `Agent ${req.agent.id} has no permission_account_blob — was provisioned before the M1.4.x migration. Recreate it via the dashboard.`,
    );
  }

  const client = await sessionClientFor({
    permissionAccountBlob: req.agent.permission_account_blob,
  });

  const callData = await client.account.encodeCalls([
    {
      to: token.address,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [req.to, amountWei],
      }),
    },
  ]);

  const userOpHash = await client.sendUserOperation({ callData });
  const receipt = await client.waitForUserOperationReceipt({
    hash: userOpHash,
  });

  return {
    status: "submitted",
    userOpHash,
    txHash: receipt.receipt.transactionHash as Hex,
  };
}
