/**
 * agentguard/intent-diff — extracts the user's intent with GPT-4o-mini,
 * then diffs each structured field against the proposed UserOp. This is
 * a mechanical comparison, not "ask an LLM if the action is safe"; the
 * LLM only does deterministic-shape extraction.
 */

import OpenAI from "openai";
import type {
  DetectionContext,
  DetectionProvider,
  DetectionResult,
  Verdict,
} from "../types";

let _client: OpenAI | null = null;
function client(): OpenAI {
  if (!_client) _client = new OpenAI();
  return _client;
}

const INTENT_SCHEMA = {
  type: "object" as const,
  additionalProperties: false,
  properties: {
    action: {
      type: "string" as const,
      enum: ["transfer", "swap", "approve", "pay", "other", "ambiguous"],
    },
    target_address: { type: ["string", "null"] as const },
    token: { type: ["string", "null"] as const },
    amount: { type: ["string", "null"] as const },
    purpose: { type: "string" as const },
  },
  required: ["action", "target_address", "token", "amount", "purpose"] as const,
};

type ExtractedIntent = {
  action: "transfer" | "swap" | "approve" | "pay" | "other" | "ambiguous";
  target_address: string | null;
  token: string | null;
  amount: string | null;
  purpose: string;
};

export const intentDiffProvider: DetectionProvider = {
  name: "agentguard/intent-diff",
  tier: "builtin",

  async detect(ctx: DetectionContext): Promise<DetectionResult> {
    const start = Date.now();

    if (!ctx.userPrompt && (!ctx.conversationLog || ctx.conversationLog.length === 0)) {
      return {
        providerName: this.name,
        tier: this.tier,
        verdict: "safe",
        score: 0,
        reasons: ["no user prompt provided — intent diff skipped"],
        latencyMs: Date.now() - start,
      };
    }

    const promptText =
      ctx.userPrompt ??
      (ctx.conversationLog
        ?.filter((m) => m.role === "user")
        .map((m) => m.content)
        .join("\n") ??
        "");

    let intent: ExtractedIntent;
    try {
      const res = await client().chat.completions.create({
        model: "gpt-4o-mini",
        messages: [
          {
            role: "system",
            content:
              "Extract the user's intended on-chain action from their prompt. " +
              "If the user did not explicitly request the action, mark it 'ambiguous'. " +
              "Return only what the user said — do not infer from missing fields.",
          },
          { role: "user", content: promptText.slice(0, 2000) },
        ],
        response_format: {
          type: "json_schema",
          json_schema: {
            name: "ExtractedIntent",
            strict: true,
            schema: INTENT_SCHEMA,
          },
        },
      });
      const content = res.choices[0]?.message.content;
      if (!content) throw new Error("empty response");
      intent = JSON.parse(content) as ExtractedIntent;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return {
        providerName: this.name,
        tier: this.tier,
        verdict: "safe",
        score: 0,
        reasons: [`intent extractor failed: ${msg.slice(0, 200)}`],
        latencyMs: Date.now() - start,
      };
    }

    const reasons: string[] = [];
    let mismatchPoints = 0;

    // Action: if user named a different action (e.g., "check weather"),
    // it's a strong mismatch. Ambiguous gets a pass.
    if (
      intent.action !== "transfer" &&
      intent.action !== "pay" &&
      intent.action !== "ambiguous"
    ) {
      reasons.push(
        `action mismatch: user intent → "${intent.action}", agent proposed transfer`,
      );
      mismatchPoints += 2;
    }

    // Target address: if user specified one, it must match (case-insensitive).
    if (intent.target_address) {
      if (
        intent.target_address.toLowerCase() !==
        ctx.proposedAction.to.toLowerCase()
      ) {
        reasons.push(
          `recipient mismatch: user → ${intent.target_address}, agent → ${ctx.proposedAction.to}`,
        );
        mismatchPoints += 3;
      }
    }

    // Token
    if (intent.token) {
      const userTok = intent.token.toUpperCase().replace(/[^A-Z0-9]/g, "");
      const actionTok = ctx.proposedAction.token.toUpperCase();
      if (userTok && userTok !== actionTok) {
        reasons.push(
          `token mismatch: user → ${intent.token}, agent → ${ctx.proposedAction.token}`,
        );
        mismatchPoints += 1;
      }
    }

    // Amount: large discrepancy (>10×) is a red flag.
    if (intent.amount) {
      const userAmt = parseFloat(intent.amount);
      const actAmt = parseFloat(ctx.proposedAction.amount);
      if (!Number.isNaN(userAmt) && !Number.isNaN(actAmt) && userAmt > 0 && actAmt > 0) {
        const ratio = Math.max(userAmt, actAmt) / Math.min(userAmt, actAmt);
        if (ratio >= 10) {
          reasons.push(
            `amount mismatch: user → ${intent.amount}, agent → ${ctx.proposedAction.amount} (${ratio.toFixed(0)}× off)`,
          );
          mismatchPoints += 2;
        } else if (ratio >= 3) {
          reasons.push(
            `amount drift: user → ${intent.amount}, agent → ${ctx.proposedAction.amount} (${ratio.toFixed(1)}× off)`,
          );
          mismatchPoints += 1;
        }
      }
    }

    const verdict: Verdict =
      mismatchPoints >= 3 ? "hostile" : mismatchPoints >= 1 ? "suspicious" : "safe";

    if (reasons.length === 0)
      reasons.push("user intent matches proposed action");

    return {
      providerName: this.name,
      tier: this.tier,
      verdict,
      score: Math.min(mismatchPoints / 5, 1),
      reasons,
      latencyMs: Date.now() - start,
    };
  },
};
