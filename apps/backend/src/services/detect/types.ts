/**
 * Pluggable AI-detection layer — SPEC §4.3.
 *
 * Each provider is a self-contained module that inspects the user's
 * upstream intent + the proposed UserOp and returns a verdict. AgentGuard
 * built-ins ship today; premium third-party providers (Lakera, Protect AI,
 * Rebuff, ...) implement the same interface and are surfaced in the
 * dashboard's Providers tab.
 */

export type Verdict = "safe" | "suspicious" | "hostile";

export type ChatMessage = {
  role: "user" | "assistant" | "system";
  content: string;
};

export type DetectionContext = {
  /** Raw user prompt that led the Agent to propose this action. */
  userPrompt?: string;
  /** Optional richer conversation log (most recent N turns). */
  conversationLog?: ChatMessage[];
  /** The concrete on-chain action the SDK is about to submit. */
  proposedAction: {
    kind: "transfer";
    to: string;
    token: string;
    amount: string;
  };
  agentMetadata: {
    agentId: string;
    name: string;
    chain: string;
  };
};

export type DetectionResult = {
  providerName: string;
  tier: "builtin" | "premium";
  verdict: Verdict;
  /** 0 = clean signal, 1 = max confidence the action is malicious. */
  score: number;
  reasons: string[];
  latencyMs: number;
};

export interface DetectionProvider {
  name: string;
  tier: "builtin" | "premium";
  detect(ctx: DetectionContext): Promise<DetectionResult>;
}
