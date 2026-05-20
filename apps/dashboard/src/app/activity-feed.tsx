"use client";

import { useEffect, useMemo, useState } from "react";
import { useWallets } from "@privy-io/react-auth";
import {
  approveApprovalApi,
  fetchActivity,
  parseDetection,
  parseSources,
  rejectApprovalApi,
  type DetectionResultJson,
  type GuardSource,
  type TxLogEntry,
} from "@/lib/activity";
import { executeAsOwner } from "@/lib/wallet/owner-execute";
import type { Address, EIP1193Provider } from "viem";

const POLL_MS = 3000;

export function ActivityFeed({ agentId }: { agentId: string }) {
  const [entries, setEntries] = useState<TxLogEntry[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pulse, setPulse] = useState(0); // increments on each successful poll

  useEffect(() => {
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    async function tick() {
      try {
        const next = await fetchActivity(agentId);
        if (alive) {
          setEntries(next);
          setError(null);
          setPulse((p) => p + 1);
        }
      } catch (err) {
        if (alive)
          setError(err instanceof Error ? err.message : String(err));
      } finally {
        if (alive) timer = setTimeout(tick, POLL_MS);
      }
    }

    tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [agentId]);

  const stats = useMemo(() => {
    let submitted = 0;
    let rejected = 0;
    for (const e of entries) {
      if (e.status === "submitted") submitted++;
      else if (e.status === "rejected") rejected++;
    }
    return { submitted, rejected, total: entries.length };
  }, [entries]);

  return (
    <section className="border border-[var(--color-border)] bg-[var(--color-bg-elev)]">
      <header className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--color-border)] bg-[var(--color-bg-inset)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em]">
        <div className="flex items-center gap-3 text-[var(--color-fg-dim)]">
          <span>activity</span>
          <span className="text-[var(--color-fg-dim)]">·</span>
          <span className="text-[var(--color-fg-muted)]">
            {stats.total} events
          </span>
          {stats.submitted > 0 && (
            <span className="text-[var(--color-ok)]">
              {stats.submitted} ok
            </span>
          )}
          {stats.rejected > 0 && (
            <span className="text-[var(--color-fail)]">
              {stats.rejected} blocked
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[var(--color-accent)]">
          <span className="pulse-dot inline-block h-1.5 w-1.5 rounded-full bg-[var(--color-accent)]" />
          live · {pulse}
        </div>
      </header>

      {/* Column header */}
      <div className="hidden grid-cols-[110px_70px_120px_90px_minmax(0,1fr)_120px] gap-3 border-b border-[var(--color-border-soft)] bg-[var(--color-bg-inset)] px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)] md:grid">
        <span>time</span>
        <span>tier</span>
        <span>guard</span>
        <span>amount</span>
        <span>recipient · hash</span>
        <span className="text-right">status</span>
      </div>

      {error && (
        <div className="border-b border-[var(--color-fail-soft)] bg-[var(--color-bg-inset)] px-4 py-2 font-mono text-[11px] text-[var(--color-fail)]">
          polling error: {error}
        </div>
      )}

      {entries.length === 0 && !error ? (
        <EmptyState />
      ) : (
        <ul className="divide-y divide-[var(--color-border-soft)]">
          {entries.map((e) => (
            <ActivityRow key={e.id} entry={e} />
          ))}
        </ul>
      )}
    </section>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Approve / Reject controls for HUMAN-tier rows
// ─────────────────────────────────────────────────────────────────────

function ApprovalControls({ entry }: { entry: TxLogEntry }) {
  const { wallets } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === "privy");
  const [busy, setBusy] = useState<"approve" | "reject" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function onApprove() {
    if (!embedded || !entry.target || !entry.token || !entry.amount) return;
    setBusy("approve");
    setError(null);
    try {
      const provider = (await embedded.getEthereumProvider()) as EIP1193Provider;
      const result = await executeAsOwner({
        ownerProvider: provider,
        ownerAddress: embedded.address as Address,
        to: entry.target as Address,
        token: entry.token as "USDC",
        amount: entry.amount,
      });
      await approveApprovalApi(entry.id, result.txHash, result.userOpHash);
      // No setBusy(null) — the polling will replace this row's status.
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function onReject() {
    setBusy("reject");
    setError(null);
    try {
      await rejectApprovalApi(entry.id, "owner rejected via dashboard");
    } catch (err) {
      setBusy(null);
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  return (
    <div className="mt-2 flex flex-col gap-2 border-t border-[var(--color-border-soft)] pt-2 font-mono text-[11px]">
      <div className="flex items-center gap-2">
        <button
          onClick={onApprove}
          disabled={busy !== null || !embedded}
          className="bg-[var(--color-accent)] px-3 py-1 uppercase tracking-wider text-[var(--color-accent-ink)] hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === "approve" ? "signing in privy…" : "approve"}
        </button>
        <button
          onClick={onReject}
          disabled={busy !== null}
          className="border border-[var(--color-border)] px-3 py-1 uppercase tracking-wider text-[var(--color-fg-muted)] hover:border-[var(--color-fail-soft)] hover:text-[var(--color-fail)] disabled:cursor-not-allowed disabled:opacity-50"
        >
          {busy === "reject" ? "rejecting…" : "reject"}
        </button>
        <span className="text-[var(--color-fg-dim)]">
          owner ({embedded?.address.slice(0, 6)}…{embedded?.address.slice(-4)}) signs via Privy
        </span>
      </div>
      {error && (
        <span className="break-words text-[var(--color-fail)]">
          {error.split("\n")[0].slice(0, 240)}
        </span>
      )}
    </div>
  );
}

function ActivityRow({ entry }: { entry: TxLogEntry }) {
  const time = new Date(entry.created_at).toLocaleTimeString([], {
    hour12: false,
  });
  const tierColor = TIER_COLORS[entry.tier];
  const statusColor = STATUS_COLORS[entry.status];
  const isPending = entry.status === "pending_approval";
  const detection = parseDetection(entry.detection);
  const sources = parseSources(entry.triggered_by);

  return (
    <li
      className={`grid grid-cols-1 gap-2 px-4 py-3 font-mono text-[12px] hover:bg-[var(--color-bg-hover)] md:grid-cols-[110px_70px_120px_90px_minmax(0,1fr)_120px] md:gap-3 ${
        isPending ? "bg-[color-mix(in_oklch,var(--color-pending)_5%,transparent)]" : ""
      }`}
    >
      <span className="text-[var(--color-fg-dim)]">{time}</span>

      <span
        className="text-[11px] font-semibold uppercase tracking-wider"
        style={{ color: tierColor }}
      >
        {entry.tier}
      </span>

      <SourceChips sources={sources} />

      <span className="text-[var(--color-fg)]">
        {entry.amount ?? "—"}{" "}
        <span className="text-[var(--color-fg-dim)]">{entry.token ?? ""}</span>
      </span>

      <div className="flex min-w-0 flex-col gap-0.5">
        {entry.target && (
          <span className="truncate text-[var(--color-fg-muted)]">
            → {entry.target}
          </span>
        )}
        {entry.tx_hash && (
          <a
            href={`https://sepolia.basescan.org/tx/${entry.tx_hash}`}
            target="_blank"
            rel="noreferrer"
            className="truncate text-[var(--color-fg)] underline decoration-dotted underline-offset-4 hover:text-[var(--color-accent)]"
          >
            {entry.tx_hash}
          </a>
        )}
        {entry.error && !isPending && (
          <span className="truncate text-[var(--color-fail-soft)]">
            {entry.error.split("\n")[0]}
          </span>
        )}
        {entry.error && isPending && (
          <span className="break-words text-[var(--color-pending)]">
            {entry.error.split("\n")[0]}
          </span>
        )}

        {detection && detection.worst !== "safe" && (
          <DetectionPanel detection={detection} />
        )}

        {isPending && <ApprovalControls entry={entry} />}
      </div>

      <span
        className="text-right text-[11px] uppercase tracking-wider"
        style={{ color: statusColor }}
      >
        {STATUS_LABELS[entry.status]}
      </span>
    </li>
  );
}

// One small chip per guard layer that fired on this row.
function SourceChips({ sources }: { sources: GuardSource[] }) {
  if (sources.length === 0) {
    return <span className="text-[var(--color-fg-dim)]">—</span>;
  }
  return (
    <span className="flex flex-wrap items-center gap-1">
      {sources.map((s) => (
        <span
          key={s}
          className="border px-1.5 py-0.5 text-[10px] uppercase tracking-wider"
          style={{
            color: SOURCE_STYLE[s].color,
            borderColor: SOURCE_STYLE[s].border,
          }}
          title={SOURCE_STYLE[s].title}
        >
          {SOURCE_STYLE[s].label}
        </span>
      ))}
    </span>
  );
}

const SOURCE_STYLE: Record<
  GuardSource,
  { label: string; color: string; border: string; title: string }
> = {
  policy: {
    label: "policy",
    color: "oklch(0.80 0.10 230)",
    border: "oklch(0.40 0.08 230)",
    title: "Policy Guard — deterministic rules (caps, whitelist, daily)",
  },
  agent: {
    label: "agent",
    color: "var(--color-accent)",
    border: "var(--color-accent-soft)",
    title: "Agent Guard — AI Detect verdicts (intent-diff, injection-signature)",
  },
};

function EmptyState() {
  return (
    <div className="flex flex-col items-start gap-3 px-4 py-8 font-mono text-[12px] text-[var(--color-fg-dim)]">
      <span className="uppercase tracking-[0.2em]">awaiting first event</span>
      <pre className="border border-[var(--color-border-soft)] bg-[var(--color-bg-inset)] px-3 py-2 text-[11px] text-[var(--color-fg-muted)]">
        $ AGENTGUARD_API_KEY=ag_test_… bun run smoke
      </pre>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// AI Detect verdict panel — only shown on non-safe rows.
// ─────────────────────────────────────────────────────────────────────

function DetectionPanel({
  detection,
}: {
  detection: DetectionResultJson;
}) {
  const color = VERDICT_COLORS[detection.worst];
  return (
    <div className="mt-2 border-t border-[var(--color-border-soft)] pt-2 font-mono text-[11px]">
      <div className="mb-1 flex items-center gap-2">
        <span
          className="text-[10px] font-semibold uppercase tracking-[0.2em]"
          style={{ color }}
        >
          ai detect · {detection.worst}
        </span>
        <span className="text-[var(--color-fg-dim)]">
          {detection.results.length} provider{detection.results.length === 1 ? "" : "s"}
        </span>
      </div>
      <ul className="space-y-1">
        {detection.results.map((r) => (
          <li key={r.provider} className="flex flex-col gap-0.5">
            <div className="flex items-center gap-2">
              <span
                className="text-[10px] uppercase tracking-wider"
                style={{ color: VERDICT_COLORS[r.verdict] }}
              >
                {r.verdict}
              </span>
              <span className="text-[var(--color-fg-muted)]">{r.provider}</span>
              <span className="ml-auto text-[var(--color-fg-dim)]">
                {r.latencyMs}ms
              </span>
            </div>
            {r.reasons.map((reason, i) => (
              <span
                key={i}
                className="break-words pl-3 text-[var(--color-fg-muted)]"
              >
                · {reason}
              </span>
            ))}
          </li>
        ))}
      </ul>
    </div>
  );
}

const VERDICT_COLORS: Record<"safe" | "suspicious" | "hostile", string> = {
  safe: "var(--color-ok)",
  suspicious: "var(--color-pending)",
  hostile: "var(--color-fail)",
};

// ─────────────────────────────────────────────────────────────────────
// Tier / status colors — semantic tokens, no rainbow palette here.
// ─────────────────────────────────────────────────────────────────────

const TIER_COLORS: Record<TxLogEntry["tier"], string> = {
  auto: "var(--color-ok)",
  guard: "var(--color-accent)",
  human: "var(--color-pending)",
};

const STATUS_COLORS: Record<TxLogEntry["status"], string> = {
  submitted: "var(--color-ok)",
  rejected: "var(--color-fail)",
  pending_approval: "var(--color-pending)",
};

const STATUS_LABELS: Record<TxLogEntry["status"], string> = {
  submitted: "ok",
  rejected: "blocked",
  pending_approval: "pending",
};
