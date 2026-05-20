import type { Hex } from "viem";

export type AgentGuardConfig = {
  apiKey: string;
  /** Backend URL. Default: http://localhost:3737 (hackathon-mode). */
  baseUrl?: string;
};

export type TransferOptions = {
  /** Recipient address (0x...). */
  to: `0x${string}`;
  /** Token symbol. Currently only "USDC" is supported. */
  token: "USDC";
  /** Human-readable amount, e.g. "0.001". */
  amount: string;
};

export type TxResult = {
  status: "submitted" | "pending_approval" | "rejected";
  userOpHash?: Hex;
  txHash?: Hex;
  approvalUrl?: string;
  reason?: string;
};

export class AgentGuardError extends Error {
  constructor(
    message: string,
    public status: number,
  ) {
    super(message);
    this.name = "AgentGuardError";
  }
}
