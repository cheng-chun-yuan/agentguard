/**
 * Registry of active detection providers.
 *
 * The interface is uniform across built-in and premium providers, so the
 * dashboard's "Providers" tab can list both and toggle them. Today only
 * AgentGuard built-ins are wired in; premium integrations (Lakera Guard,
 * Protect AI, Rebuff, ...) plug in by adding their `DetectionProvider`
 * implementation here.
 */

import type {
  DetectionContext,
  DetectionProvider,
  DetectionResult,
  Verdict,
} from "./types";
import { intentDiffProvider } from "./providers/intent-diff";
import { injectionSignatureProvider } from "./providers/injection-signature";

export const builtinProviders: DetectionProvider[] = [
  intentDiffProvider,
  injectionSignatureProvider,
];

/** Run every active provider in parallel and collect verdicts. */
export async function runDetectors(
  ctx: DetectionContext,
): Promise<DetectionResult[]> {
  return Promise.all(
    builtinProviders.map((p) =>
      p.detect(ctx).catch(
        (err): DetectionResult => ({
          providerName: p.name,
          tier: p.tier,
          verdict: "safe",
          score: 0,
          reasons: [
            `provider crashed: ${err instanceof Error ? err.message : String(err)}`,
          ],
          latencyMs: 0,
        }),
      ),
    ),
  );
}

export type Aggregate = {
  worst: Verdict;
  tierBump: 0 | 1 | 2;
  reasons: string[];
  results: DetectionResult[];
};

/** Roll up parallel verdicts into a single "how much should policy escalate?" answer. */
export function aggregate(results: DetectionResult[]): Aggregate {
  let worst: Verdict = "safe";
  const reasons: string[] = [];

  for (const r of results) {
    if (r.verdict === "hostile") worst = "hostile";
    else if (r.verdict === "suspicious" && worst !== "hostile")
      worst = "suspicious";

    if (r.verdict !== "safe") {
      reasons.push(`${r.providerName} ${r.verdict.toUpperCase()}: ${r.reasons.join("; ")}`);
    }
  }

  const tierBump: 0 | 1 | 2 =
    worst === "hostile" ? 2 : worst === "suspicious" ? 1 : 0;

  return { worst, tierBump, reasons, results };
}
