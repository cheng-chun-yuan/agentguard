"use client";

import { useEffect, useState } from "react";
import {
  usePrivy,
  useWallets,
  useSign7702Authorization,
} from "@privy-io/react-auth";
import {
  provisionAgent,
  type ProvisionedAgent,
} from "@/lib/wallet/provision";
import { fetchAgentsForOwner, type AgentListEntry } from "@/lib/activity";
import { ActivityFeed } from "./activity-feed";
import { PolicyPanel } from "./policy-panel";
import type { EIP1193Provider, Address } from "viem";
import type { SignAuthorizationReturnType } from "viem/accounts";

type EmbeddedWallet = NonNullable<
  ReturnType<typeof useWallets>["wallets"][number]
>;

const shortAddr = (addr: string | null | undefined) =>
  !addr ? "—" : `${addr.slice(0, 6)}…${addr.slice(-4)}`;

// ─────────────────────────────────────────────────────────────────────
// Root
// ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === "privy");

  if (!ready) return <Booting />;

  return (
    <main className="mx-auto flex w-full max-w-[1080px] flex-1 flex-col">
      <TopBar
        authenticated={authenticated}
        ownerAddress={embedded?.address ?? null}
        email={user?.email?.address ?? null}
        onLogin={login}
        onLogout={logout}
      />

      {!authenticated ? (
        <Landing onLogin={login} />
      ) : (
        <Workspace
          email={user?.email?.address ?? null}
          embeddedWallet={embedded ?? null}
        />
      )}

      <Footer />
    </main>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Top bar
// ─────────────────────────────────────────────────────────────────────

function TopBar({
  authenticated,
  ownerAddress,
  email,
  onLogin,
  onLogout,
}: {
  authenticated: boolean;
  ownerAddress: string | null;
  email: string | null;
  onLogin: () => void;
  onLogout: () => void;
}) {
  return (
    <header className="flex items-center justify-between border-b border-[var(--color-border)] px-6 py-4">
      <div className="flex items-center gap-4 font-mono text-[11px] tracking-wider uppercase">
        <Logo />
        <Divider />
        <span className="text-[var(--color-fg-muted)]">base-sepolia</span>
      </div>

      <div className="flex items-center gap-3 font-mono text-[11px]">
        {authenticated ? (
          <>
            <span className="hidden text-[var(--color-fg-dim)] md:inline">
              {email ?? "no email"}
            </span>
            <span className="border border-[var(--color-border)] px-2 py-1 text-[var(--color-fg-muted)]">
              {shortAddr(ownerAddress)}
            </span>
            <button
              onClick={onLogout}
              className="border border-[var(--color-border)] px-3 py-1 uppercase tracking-wider text-[var(--color-fg-muted)] transition-colors hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]"
            >
              logout
            </button>
          </>
        ) : (
          <button
            onClick={onLogin}
            className="bg-[var(--color-accent)] px-4 py-1.5 uppercase tracking-wider text-[var(--color-accent-ink)] transition-opacity hover:opacity-90"
          >
            sign in
          </button>
        )}
      </div>
    </header>
  );
}

function Logo() {
  return (
    <span className="flex items-center gap-2">
      <span className="grid h-5 w-5 place-items-center border border-[var(--color-accent)] text-[var(--color-accent)]">
        <span className="block h-1.5 w-1.5 bg-[var(--color-accent)]" />
      </span>
      <span className="font-display text-sm font-semibold text-[var(--color-fg)]">
        agentguard
      </span>
    </span>
  );
}

function Divider() {
  return <span className="h-3 w-px bg-[var(--color-border)]" />;
}

// ─────────────────────────────────────────────────────────────────────
// Landing
// ─────────────────────────────────────────────────────────────────────

function Landing({ onLogin }: { onLogin: () => void }) {
  return (
    <section className="flex flex-1 flex-col gap-16 px-6 py-20 md:py-28">
      <div className="grid items-center gap-12 md:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex flex-col gap-7">
          <span className="font-mono text-[11px] uppercase tracking-[0.25em] text-[var(--color-accent)]">
            secure execution · AI agents
          </span>
          <h1 className="text-balance font-display text-[48px] font-medium leading-[1.02] tracking-tight md:text-[68px]">
            Drop an API key.
            <br />
            <span className="text-[var(--color-fg-muted)]">Your agent transacts</span>
            <br />
            on-chain.{" "}
            <span className="text-[var(--color-accent)]">Safely.</span>
          </h1>
          <p className="max-w-[40ch] text-[16px] text-[var(--color-fg-muted)]">
            Non-custodial. Three-tier policy. AI-aware.
          </p>
          <div className="flex flex-wrap items-center gap-5">
            <button
              onClick={onLogin}
              className="bg-[var(--color-accent)] px-5 py-2.5 font-mono text-[12px] uppercase tracking-wider text-[var(--color-accent-ink)] transition-opacity hover:opacity-90"
            >
              sign in
            </button>
            <a
              href="https://github.com/cheng-chun-yuan/agentguard"
              target="_blank"
              rel="noreferrer"
              className="font-mono text-[12px] uppercase tracking-wider text-[var(--color-fg-muted)] underline decoration-dotted underline-offset-4 hover:text-[var(--color-fg)]"
            >
              github →
            </a>
          </div>
        </div>

        <SdkPreview />
      </div>

      <Tiers />
    </section>
  );
}

// Pre-tokenized SDK example. Each token carries its semantic color so we
// can both syntax-highlight AND reveal it character-by-character without
// re-parsing the buffer on every animation frame.
type CodeTok = { t: string; c?: "dim" | "fg" | "str" };

const SDK_PREVIEW_TOKENS: CodeTok[] = [
  { t: "import", c: "dim" },
  { t: " { AgentGuard } " },
  { t: "from", c: "dim" },
  { t: " " },
  { t: `"@agentguard/sdk"`, c: "str" },
  { t: "\n\n" },
  { t: "const", c: "dim" },
  { t: " guard " },
  { t: "=", c: "dim" },
  { t: " " },
  { t: "new", c: "dim" },
  { t: " AgentGuard({\n  apiKey: process.env.AGENTGUARD_API_KEY,\n})" },
  { t: "\n\n" },
  { t: "await", c: "dim" },
  { t: " guard.transfer({\n  to: " },
  { t: `"0x…"`, c: "str" },
  { t: ",\n  token: " },
  { t: `"USDC"`, c: "str" },
  { t: ",\n  amount: " },
  { t: `"0.001"`, c: "str" },
  { t: ",\n})" },
];

const SDK_FULL_LEN = SDK_PREVIEW_TOKENS.reduce((n, k) => n + k.t.length, 0);

const TOK_COLOR: Record<NonNullable<CodeTok["c"]>, string> = {
  dim: "var(--color-fg-dim)",
  fg: "var(--color-fg)",
  str: "var(--color-accent)",
};

function SdkPreview() {
  const [shown, setShown] = useState(0);

  useEffect(() => {
    // ~42 chars/sec, slight initial delay so the user notices it start.
    const start = performance.now() + 250;
    let raf = 0;
    const tick = () => {
      const elapsed = Math.max(0, performance.now() - start);
      const target = Math.min(Math.floor(elapsed / 24), SDK_FULL_LEN);
      setShown(target);
      if (target < SDK_FULL_LEN) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, []);

  // Walk the token list and emit only as many characters as we should show.
  const visible: CodeTok[] = [];
  let budget = shown;
  for (const tok of SDK_PREVIEW_TOKENS) {
    if (budget <= 0) break;
    if (budget >= tok.t.length) {
      visible.push(tok);
      budget -= tok.t.length;
    } else {
      visible.push({ ...tok, t: tok.t.slice(0, budget) });
      budget = 0;
    }
  }
  const done = shown >= SDK_FULL_LEN;

  return (
    <div className="self-start border border-[var(--color-border)] bg-[var(--color-bg-inset)]">
      <div className="flex items-center justify-between border-b border-[var(--color-border)] px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">
        <span>example.ts</span>
        <span>typescript</span>
      </div>
      <pre className="min-h-[280px] overflow-x-auto whitespace-pre px-4 py-3 font-mono text-[12px] leading-[1.7]">
        {visible.map((tok, i) => (
          <span key={i} style={tok.c ? { color: TOK_COLOR[tok.c] } : undefined}>
            {tok.t}
          </span>
        ))}
        <span
          aria-hidden
          className={`ml-0.5 inline-block w-[7px] align-[-1px] text-[var(--color-accent)] ${
            done ? "pulse-dot" : ""
          }`}
        >
          ▍
        </span>
      </pre>
    </div>
  );
}

function Tiers() {
  const rows: { tier: string; trigger: string; signer: string; color: string }[] = [
    {
      tier: "AUTO",
      trigger: "≤ on-chain cap, whitelisted target",
      signer: "agent session key",
      color: "var(--color-ok)",
    },
    {
      tier: "GUARD",
      trigger: "passes policy + anomaly screen",
      signer: "backend (bounded session)",
      color: "var(--color-accent)",
    },
    {
      tier: "HUMAN",
      trigger: "exceeds limit · suspicious · new recipient",
      signer: "you, via Privy",
      color: "var(--color-pending)",
    },
  ];

  return (
    <div className="border border-[var(--color-border)]">
      <div className="border-b border-[var(--color-border)] bg-[var(--color-bg-inset)] px-4 py-2 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
        three-tier execution
      </div>
      <ul className="divide-y divide-[var(--color-border)]">
        {rows.map((r) => (
          <li
            key={r.tier}
            className="grid grid-cols-[120px_minmax(0,1fr)_180px] items-center gap-4 px-4 py-3 font-mono text-[12px]"
          >
            <span
              className="text-[11px] font-semibold uppercase tracking-wider"
              style={{ color: r.color }}
            >
              {r.tier}
            </span>
            <span className="text-[var(--color-fg-muted)]">{r.trigger}</span>
            <span className="text-right text-[var(--color-fg-dim)]">{r.signer}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Workspace (post-auth)
// ─────────────────────────────────────────────────────────────────────

function Workspace({
  email,
  embeddedWallet,
}: {
  email: string | null;
  embeddedWallet: EmbeddedWallet | null;
}) {
  const [provisioned, setProvisioned] = useState<ProvisionedAgent | null>(null);
  const [existing, setExisting] = useState<AgentListEntry | null>(null);

  // On mount (and when the wallet changes), fetch any agent the backend
  // already holds for this owner. Lets the dashboard resume across reloads
  // without re-provisioning — only the API key is unrecoverable, since
  // we deliberately do not persist it client-side.
  useEffect(() => {
    if (!embeddedWallet?.address) return;
    let alive = true;
    fetchAgentsForOwner(embeddedWallet.address)
      .then((agents) => {
        if (!alive) return;
        const newest = agents[0] ?? null;
        setExisting(newest);
      })
      .catch(() => {
        /* ignore — empty state will show */
      });
    return () => {
      alive = false;
    };
  }, [embeddedWallet?.address]);

  const activeAgentId = provisioned?.id ?? existing?.id ?? null;

  return (
    <section className="flex flex-1 flex-col gap-8 px-6 py-10">
      <div className="flex flex-wrap items-end justify-between gap-3 border-b border-[var(--color-border)] pb-4">
        <div className="flex flex-col gap-1">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
            workspace
          </span>
          <h2 className="font-display text-[26px] font-medium tracking-tight">
            {email ?? "welcome"}
          </h2>
        </div>
        <span className="font-mono text-[11px] text-[var(--color-fg-dim)]">
          owner&nbsp;
          <span className="text-[var(--color-fg-muted)]">
            {shortAddr(embeddedWallet?.address ?? null)}
          </span>
        </span>
      </div>

      <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <OwnerPanel walletAddress={embeddedWallet?.address ?? null} />
        {provisioned ? (
          <CreateAgentPanel
            embeddedWallet={embeddedWallet}
            onProvisioned={setProvisioned}
            provisioned={provisioned}
          />
        ) : existing ? (
          <ExistingAgentPanel
            agent={existing}
            onCreateAnother={() => setExisting(null)}
          />
        ) : (
          <CreateAgentPanel
            embeddedWallet={embeddedWallet}
            onProvisioned={setProvisioned}
            provisioned={null}
          />
        )}
      </div>

      {provisioned && <PolicyPanel apiKey={provisioned.apiKey} />}

      {activeAgentId ? (
        <ActivityFeed agentId={activeAgentId} />
      ) : (
        <ActivityPlaceholder />
      )}
    </section>
  );
}

function ExistingAgentPanel({
  agent,
  onCreateAnother,
}: {
  agent: AgentListEntry;
  onCreateAnother: () => void;
}) {
  return (
    <Panel
      label="agent · active"
      rightSlot={
        <span className="font-mono text-[10px] text-[var(--color-ok)]">
          resumed
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-4 gap-y-3 text-[12px]">
          <Label>name</Label>
          <span className="font-mono text-[var(--color-fg)]">{agent.name}</span>

          <Label>account</Label>
          <a
            href={`https://sepolia.basescan.org/address/${agent.smart_account_address}`}
            target="_blank"
            rel="noreferrer"
            className="break-all font-mono text-[11px] text-[var(--color-fg)] underline decoration-dotted underline-offset-4 hover:text-[var(--color-accent)]"
          >
            {agent.smart_account_address}
          </a>

          <Label>session</Label>
          <span className="break-all font-mono text-[11px] text-[var(--color-fg-muted)]">
            {agent.agent_session_pubkey}
          </span>
        </div>

        <p className="font-mono text-[11px] text-[var(--color-fg-dim)]">
          your api key is not stored in the browser. if you lost it,
          provision a fresh agent below.
        </p>

        <button
          onClick={onCreateAnother}
          className="self-start border border-[var(--color-border)] px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-[var(--color-fg-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]"
        >
          + new agent
        </button>
      </div>
    </Panel>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Panels
// ─────────────────────────────────────────────────────────────────────

function Panel({
  label,
  children,
  rightSlot,
}: {
  label: string;
  children: React.ReactNode;
  rightSlot?: React.ReactNode;
}) {
  return (
    <section className="border border-[var(--color-border)] bg-[var(--color-bg-elev)]">
      <header className="flex items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-bg-inset)] px-4 py-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
          {label}
        </span>
        {rightSlot}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

function OwnerPanel({ walletAddress }: { walletAddress: string | null }) {
  return (
    <Panel
      label="owner / validator 1"
      rightSlot={
        <span className="font-mono text-[10px] text-[var(--color-fg-dim)]">
          privy · TEE
        </span>
      }
    >
      <div className="flex flex-col gap-3">
        {walletAddress ? (
          <code className="break-all bg-[var(--color-bg-inset)] px-3 py-2 font-mono text-[12px] text-[var(--color-fg)]">
            {walletAddress}
          </code>
        ) : (
          <span className="text-sm text-[var(--color-fg-dim)]">Provisioning…</span>
        )}
        <p className="text-[13px] leading-[1.55] text-[var(--color-fg-muted)]">
          The smart account derives its address from your embedded wallet
          via EIP-7702. The private key never leaves Privy&apos;s TEE; the
          backend only holds session keys with on-chain enforced limits.
        </p>
      </div>
    </Panel>
  );
}

function CreateAgentPanel({
  embeddedWallet,
  provisioned,
  onProvisioned,
}: {
  embeddedWallet: EmbeddedWallet | null;
  provisioned: ProvisionedAgent | null;
  onProvisioned: (agent: ProvisionedAgent) => void;
}) {
  const [name, setName] = useState("my-agent");
  const [onChainCap, setOnChainCap] = useState("0.01");
  const [status, setStatus] = useState<
    "idle" | "provisioning" | "error"
  >("idle");
  const [error, setError] = useState<string | null>(null);
  const { signAuthorization } = useSign7702Authorization();
  const [copied, setCopied] = useState(false);

  async function handleCreate() {
    if (!embeddedWallet) return;
    setError(null);
    setStatus("provisioning");
    try {
      const provider =
        (await embeddedWallet.getEthereumProvider()) as EIP1193Provider;
      // USDC has 6 decimals — translate the human input to atomic units.
      const capWhole = onChainCap.trim();
      let capAtomic: bigint | undefined;
      if (capWhole && /^[0-9]+(\.[0-9]+)?$/.test(capWhole)) {
        const [intPart, fracPart = ""] = capWhole.split(".");
        const padded = (fracPart + "000000").slice(0, 6);
        capAtomic = BigInt(intPart + padded);
      }
      const result = await provisionAgent({
        name,
        ownerProvider: provider,
        ownerAddress: embeddedWallet.address as Address,
        signAuthorization: (params) =>
          signAuthorization(params) as Promise<SignAuthorizationReturnType>,
        onChainCapAtomic: capAtomic,
      });
      onProvisioned(result);
      setStatus("idle");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus("error");
    }
  }

  if (provisioned) {
    async function copyKey() {
      await navigator.clipboard.writeText(provisioned!.apiKey);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }

    return (
      <Panel
        label="agent · active"
        rightSlot={
          <span className="font-mono text-[10px] text-[var(--color-ok)]">
            ready
          </span>
        }
      >
        <div className="flex flex-col gap-4">
          <div className="grid grid-cols-[80px_minmax(0,1fr)] gap-x-4 gap-y-3 text-[12px]">
            <Label>name</Label>
            <span className="font-mono text-[var(--color-fg)]">
              {provisioned.name}
            </span>

            <Label>api key</Label>
            <div className="flex items-center gap-2">
              <code className="flex-1 overflow-x-auto bg-[var(--color-bg-inset)] px-2 py-1 font-mono text-[11px] text-[var(--color-accent)]">
                {provisioned.apiKey}
              </code>
              <button
                onClick={copyKey}
                className="border border-[var(--color-border)] px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-muted)] hover:border-[var(--color-border-strong)] hover:text-[var(--color-fg)]"
              >
                {copied ? "copied" : "copy"}
              </button>
            </div>

            <Label>account</Label>
            <a
              href={`https://sepolia.basescan.org/address/${provisioned.smartAccountAddress}`}
              target="_blank"
              rel="noreferrer"
              className="break-all font-mono text-[11px] text-[var(--color-fg)] underline decoration-dotted underline-offset-4 hover:text-[var(--color-accent)]"
            >
              {provisioned.smartAccountAddress}
            </a>

            <Label>init tx</Label>
            <a
              href={`https://sepolia.basescan.org/tx/${provisioned.initTxHash}`}
              target="_blank"
              rel="noreferrer"
              className="break-all font-mono text-[11px] text-[var(--color-fg-muted)] underline decoration-dotted underline-offset-4 hover:text-[var(--color-accent)]"
            >
              {provisioned.initTxHash}
            </a>
          </div>

          <p className="border border-[var(--color-border-soft)] bg-[var(--color-bg-inset)] px-3 py-2 font-mono text-[11px] text-[var(--color-pending)]">
            treat the API key like a Stripe key — it won&apos;t be shown again.
          </p>
        </div>
      </Panel>
    );
  }

  return (
    <Panel
      label="new agent"
      rightSlot={
        <span className="font-mono text-[10px] text-[var(--color-fg-dim)]">
          7702 · v3.3 · paymaster
        </span>
      }
    >
      <div className="flex flex-col gap-4">
        <p className="text-[13px] text-[var(--color-fg-muted)]">
          One Privy popup signs the EIP-7702 authorization. Backend
          mints + stores a session key with a 0.01 USDC per-call cap.
        </p>

        <label className="flex flex-col gap-1.5">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
            name
          </span>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            disabled={status === "provisioning"}
            className="border border-[var(--color-border)] bg-[var(--color-bg-inset)] px-3 py-2 font-mono text-[13px] text-[var(--color-fg)] focus:border-[var(--color-accent)] focus:outline-none disabled:opacity-50"
          />
        </label>

        <label className="flex flex-col gap-1.5">
          <span className="flex items-center justify-between font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
            <span>on-chain hard cap</span>
            <span className="text-[var(--color-accent)]">baked on-chain</span>
          </span>
          <div className="flex items-center gap-2 border border-[var(--color-border)] bg-[var(--color-bg-inset)] px-3 py-2">
            <input
              type="text"
              value={onChainCap}
              onChange={(e) => setOnChainCap(e.target.value)}
              disabled={status === "provisioning"}
              inputMode="decimal"
              className="flex-1 bg-transparent font-mono text-[13px] text-[var(--color-fg)] focus:outline-none disabled:opacity-50"
            />
            <span className="font-mono text-[10px] uppercase tracking-wider text-[var(--color-fg-dim)]">
              USDC
            </span>
          </div>
          <span className="font-mono text-[10px] text-[var(--color-fg-dim)]">
            Kernel validator rejects any single transfer above this. Can&apos;t be
            edited later without rotating the session key.
          </span>
        </label>

        <button
          onClick={handleCreate}
          disabled={
            !embeddedWallet ||
            status === "provisioning" ||
            name.trim().length === 0
          }
          className="bg-[var(--color-accent)] px-4 py-2.5 font-mono text-[12px] uppercase tracking-wider text-[var(--color-accent-ink)] transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:bg-[var(--color-border)] disabled:text-[var(--color-fg-dim)]"
        >
          {status === "provisioning"
            ? "signing in privy…"
            : "create agent →"}
        </button>

        {error && (
          <div className="border border-[var(--color-fail-soft)] bg-[var(--color-bg-inset)] px-3 py-2 font-mono text-[11px] text-[var(--color-fail)]">
            <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-fail-soft)]">
              provisioning failed
            </div>
            <div className="mt-1 break-words text-[var(--color-fg-muted)]">
              {error}
            </div>
          </div>
        )}
      </div>
    </Panel>
  );
}

function Label({ children }: { children: React.ReactNode }) {
  return (
    <span className="self-start font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
      {children}
    </span>
  );
}

function ActivityPlaceholder() {
  return (
    <div className="border border-dashed border-[var(--color-border)] px-6 py-10 text-center">
      <p className="font-mono text-[12px] text-[var(--color-fg-muted)]">
        create an agent to start the live activity feed.
      </p>
    </div>
  );
}

// ─────────────────────────────────────────────────────────────────────
// Boot / Footer
// ─────────────────────────────────────────────────────────────────────

function Booting() {
  return (
    <main className="flex flex-1 items-center justify-center">
      <span className="font-mono text-[11px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
        booting…
      </span>
    </main>
  );
}

function Footer() {
  return (
    <footer className="mt-auto flex items-center justify-between border-t border-[var(--color-border)] px-6 py-4 font-mono text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
      <span>agentguard</span>
      <a
        href="https://github.com/cheng-chun-yuan/agentguard"
        target="_blank"
        rel="noreferrer"
        className="text-[var(--color-fg-muted)] underline decoration-dotted underline-offset-4 hover:text-[var(--color-accent)]"
      >
        github
      </a>
    </footer>
  );
}
