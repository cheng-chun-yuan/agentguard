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
 * Upstream context passed into the AI Guard layer (SPEC §4.3).
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
  /** Optional upstream context for AI Guard. */
  intentContext?: IntentContext;
};

// ─── x402 — HTTP-native micropayments ────────────────────────────────

export type X402PaymentRequirement = {
  scheme: string;
  network: string;
  /** Atomic-unit amount (string). USDC = 6 decimals. */
  maxAmountRequired: string;
  resource: string;
  description?: string;
  mimeType?: string;
  /** Recipient address that gets paid. */
  payTo: `0x${string}`;
  maxTimeoutSeconds?: number;
  /** Token contract address. */
  asset: `0x${string}`;
  extra?: { name?: string; version?: string; decimals?: number };
};

export type X402Response = {
  x402Version: number;
  accepts: X402PaymentRequirement[];
  error?: string;
};

/** Encoded into the `X-PAYMENT` header on a 402-retry request. */
export type X402Settlement = {
  x402Version: 1;
  /** "settled" = AgentGuard already executed the on-chain payment. */
  scheme: "settled";
  network: string;
  payload: {
    txHash: Hex;
    from: `0x${string}`;
    to: `0x${string}`;
    value: string;
    asset: `0x${string}`;
  };
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
