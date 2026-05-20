"use client";

import { useEffect, useState } from "react";
import {
  fetchPolicy,
  patchPolicy,
  type AgentPolicy,
} from "@/lib/policy";

/**
 * PolicyPanel — editable per-agent policy.
 *
 * Hard cap (on-chain validator) is read-only here; changing it requires
 * rotating the session key — owned by CreateAgentPanel / RotateButton.
 */
export function PolicyPanel({ apiKey }: { apiKey: string }) {
  const [policy, setPolicy] = useState<AgentPolicy | null>(null);
  const [draft, setDraft] = useState<Partial<AgentPolicy>>({});
  const [busy, setBusy] = useState<"loading" | "saving" | "idle">("loading");
  const [error, setError] = useState<string | null>(null);
  const [savedAt, setSavedAt] = useState<number | null>(null);

  useEffect(() => {
    let alive = true;
    fetchPolicy(apiKey)
      .then((p) => {
        if (!alive) return;
        setPolicy(p);
        setDraft(p);
        setBusy("idle");
      })
      .catch((err) => {
        if (!alive) return;
        setError(err instanceof Error ? err.message : String(err));
        setBusy("idle");
      });
    return () => {
      alive = false;
    };
  }, [apiKey]);

  function field<K extends keyof AgentPolicy>(
    key: K,
    value: AgentPolicy[K],
  ): void {
    setDraft((d) => ({ ...d, [key]: value }));
  }

  async function save() {
    if (!policy) return;
    setBusy("saving");
    setError(null);
    try {
      const next = await patchPolicy(apiKey, {
        autoPerCallUsdc: draft.autoPerCallUsdc ?? policy.autoPerCallUsdc,
        guardPerCallUsdc: draft.guardPerCallUsdc ?? policy.guardPerCallUsdc,
        dailyUsdc: draft.dailyUsdc ?? policy.dailyUsdc,
        whitelist: draft.whitelist ?? policy.whitelist,
        requireWhitelist:
          draft.requireWhitelist ?? policy.requireWhitelist,
      });
      // Merge the hard cap back in (server response strips it on PATCH).
      setPolicy({ ...next, onChainCapUsdc: policy.onChainCapUsdc });
      setDraft({ ...next, onChainCapUsdc: policy.onChainCapUsdc });
      setSavedAt(Date.now());
      setBusy("idle");
    } catch (err) {
      setBusy("idle");
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  if (busy === "loading") {
    return (
      <section className="border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-5 font-mono text-[11px] text-[var(--color-fg-dim)]">
        loading policy…
      </section>
    );
  }

  if (!policy) {
    return (
      <section className="border border-[var(--color-fail-soft)] bg-[var(--color-bg-elev)] p-5 font-mono text-[11px] text-[var(--color-fail)]">
        could not load policy: {error}
      </section>
    );
  }

  const dirty =
    (draft.autoPerCallUsdc ?? policy.autoPerCallUsdc) !== policy.autoPerCallUsdc ||
    (draft.guardPerCallUsdc ?? policy.guardPerCallUsdc) !== policy.guardPerCallUsdc ||
    (draft.dailyUsdc ?? policy.dailyUsdc) !== policy.dailyUsdc ||
    JSON.stringify(draft.whitelist ?? policy.whitelist) !==
      JSON.stringify(policy.whitelist) ||
    (draft.requireWhitelist ?? policy.requireWhitelist) !==
      policy.requireWhitelist;

  return (
    <section className="border border-[var(--color-border)] bg-[var(--color-bg-elev)]">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-inset)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
        <span>policy</span>
        <span className="text-[var(--color-fg-dim)]">
          {savedAt
            ? `saved ${new Date(savedAt).toLocaleTimeString([], { hour12: false })}`
            : "hot-applied to next /transfer"}
        </span>
      </header>

      <div className="grid gap-x-6 gap-y-4 p-5 md:grid-cols-2">
        {/* Hard cap — read-only */}
        <div className="md:col-span-2 border border-[var(--color-border-soft)] bg-[var(--color-bg-inset)] px-3 py-2 font-mono text-[11px]">
          <div className="flex items-center justify-between">
            <span className="uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
              on-chain hard cap
            </span>
            <span className="text-[var(--color-accent)]">
              {policy.onChainCapUsdc ?? "—"} USDC
            </span>
          </div>
          <p className="mt-1.5 text-[10px] text-[var(--color-fg-dim)]">
            stored in the Kernel permission validator on-chain · rotating the
            session key is required to change it
          </p>
        </div>

        <PolicyField
          label="auto per-call cap"
          value={draft.autoPerCallUsdc ?? policy.autoPerCallUsdc}
          onChange={(v) => field("autoPerCallUsdc", v)}
          hint="≤ auto, recipient seen → AUTO tier"
          suffix="USDC"
        />

        <PolicyField
          label="guard per-call cap"
          value={draft.guardPerCallUsdc ?? policy.guardPerCallUsdc}
          onChange={(v) => field("guardPerCallUsdc", v)}
          hint="above this → HUMAN"
          suffix="USDC"
        />

        <PolicyField
          label="daily total cap"
          value={draft.dailyUsdc ?? policy.dailyUsdc}
          onChange={(v) => field("dailyUsdc", v)}
          hint="rolling 24h window"
          suffix="USDC"
        />

        <div className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
            require whitelist
          </span>
          <label className="flex items-center gap-2 font-mono text-[12px] text-[var(--color-fg)]">
            <input
              type="checkbox"
              checked={
                draft.requireWhitelist ?? policy.requireWhitelist
              }
              onChange={(e) =>
                field("requireWhitelist", e.target.checked)
              }
              className="h-3.5 w-3.5 accent-[var(--color-accent)]"
            />
            <span className="text-[var(--color-fg-muted)]">
              off-list transfers go to HUMAN
            </span>
          </label>
        </div>

        <div className="md:col-span-2 flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
            whitelist
          </span>
          <textarea
            value={(draft.whitelist ?? policy.whitelist).join("\n")}
            onChange={(e) =>
              field(
                "whitelist",
                e.target.value
                  .split(/\s+/)
                  .map((s) => s.trim())
                  .filter((s) => /^0x[a-fA-F0-9]{40}$/.test(s)),
              )
            }
            placeholder="0x... (one address per line)"
            rows={3}
            className="border border-[var(--color-border)] bg-[var(--color-bg-inset)] px-3 py-2 font-mono text-[11px] text-[var(--color-fg)] focus:border-[var(--color-accent)] focus:outline-none"
          />
        </div>
      </div>

      <div className="flex items-center justify-between border-t border-[var(--color-border)] bg-[var(--color-bg-inset)] px-4 py-3">
        <span className="font-mono text-[10px] text-[var(--color-fg-dim)]">
          {error ? (
            <span className="text-[var(--color-fail)]">{error}</span>
          ) : dirty ? (
            <span className="text-[var(--color-pending)]">unsaved changes</span>
          ) : (
            "all changes saved"
          )}
        </span>
        <button
          onClick={save}
          disabled={!dirty || busy === "saving"}
          className="bg-[var(--color-accent)] px-4 py-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--color-accent-ink)] hover:opacity-90 disabled:cursor-not-allowed disabled:bg-[var(--color-border)] disabled:text-[var(--color-fg-dim)]"
        >
          {busy === "saving" ? "saving…" : "save"}
        </button>
      </div>
    </section>
  );
}

function PolicyField({
  label,
  value,
  onChange,
  hint,
  suffix,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  suffix?: string;
}) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
        {label}
      </span>
      <div className="flex items-center gap-2 border border-[var(--color-border)] bg-[var(--color-bg-inset)] px-3 py-1.5">
        <input
          type="text"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          inputMode="decimal"
          className="flex-1 bg-transparent font-mono text-[12px] text-[var(--color-fg)] focus:outline-none"
        />
        {suffix && (
          <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">
            {suffix}
          </span>
        )}
      </div>
      {hint && (
        <span className="font-mono text-[10px] text-[var(--color-fg-dim)]">
          {hint}
        </span>
      )}
    </label>
  );
}
