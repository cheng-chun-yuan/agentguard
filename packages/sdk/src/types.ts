import type { Hex } from "viem";

export type AgentGuardConfig = {
  apiKey: string;
  /** Backend URL. Default: http://localhost:3737 (hackathon-mode). */
  baseUrl?: string;
};

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

/**
 * Upstream context passed into the AI Detect layer (SPEC §4.3).
 *
 * Provide either a `userPrompt` (the literal user request the Agent
 * acted on), a `conversationLog` (most recent N turns), or both. When
 * provided, the policy engine runs configured detection providers
 * before routing — mismatches between user intent and proposed
 * UserOp escalate to HUMAN.
 */
export type IntentContext = {
  userPrompt?: string;
  conversationLog?: ChatMessage[];
};

export type TransferOptions = {
  /** Recipient address (0x...). */
  to: `0x${string}`;
  /** Token symbol. Currently only "USDC" is supported. */
  token: "USDC";
  /** Human-readable amount, e.g. "0.001". */
  amount: string;
  /** Optional upstream context for AI Detect. */
  intentContext?: IntentContext;
};

/** Result tier — which execution path the policy engine chose. */
export type Tier = "auto" | "guard" | "human";

export type TxResult =
  | {
      status: "submitted";
      tier: "auto" | "guard";
      userOpHash: Hex;
      txHash: Hex;
    }
  | {
      status: "pending_approval";
      tier: "human";
      approvalId: string;
      approvalUrl: string;
      reason: string;
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
