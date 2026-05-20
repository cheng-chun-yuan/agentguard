"use client";

import { useState } from "react";
import {
  usePrivy,
  useWallets,
  useSign7702Authorization,
} from "@privy-io/react-auth";
import {
  provisionAgent,
  type ProvisionedAgent,
} from "@/lib/wallet/provision";
import type { EIP1193Provider, Address } from "viem";
import type { SignAuthorizationReturnType } from "viem/accounts";

export default function Home() {
  const { ready, authenticated, user, login, logout } = usePrivy();
  const { wallets } = useWallets();
  const embedded = wallets.find((w) => w.walletClientType === "privy");

  if (!ready) {
    return (
      <main className="flex flex-1 items-center justify-center text-sm text-zinc-500">
        Loading…
      </main>
    );
  }

  return (
    <main className="flex flex-1 flex-col">
      <header className="flex items-center justify-between border-b border-zinc-200 px-8 py-4 dark:border-zinc-800">
        <div className="flex items-center gap-2">
          <span className="text-2xl">🛡️</span>
          <span className="text-lg font-semibold tracking-tight">
            AgentGuard
          </span>
          <span className="ml-3 rounded bg-zinc-100 px-2 py-0.5 text-[11px] uppercase tracking-wide text-zinc-600 dark:bg-zinc-800 dark:text-zinc-400">
            Base Sepolia
          </span>
        </div>

        {authenticated ? (
          <button
            onClick={logout}
            className="rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm font-medium hover:bg-zinc-50 dark:border-zinc-800 dark:bg-zinc-900 dark:hover:bg-zinc-800"
          >
            Log out
          </button>
        ) : (
          <button
            onClick={login}
            className="rounded-md bg-sky-500 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-600"
          >
            Sign in
          </button>
        )}
      </header>

      {!authenticated ? (
        <Landing onLogin={login} />
      ) : (
        <Dashboard
          email={user?.email?.address ?? null}
          walletAddress={embedded?.address ?? null}
          embeddedWallet={embedded ?? null}
        />
      )}
    </main>
  );
}

function Landing({ onLogin }: { onLogin: () => void }) {
  return (
    <section className="flex flex-1 items-center justify-center px-8">
      <div className="max-w-2xl space-y-6 text-center">
        <h1 className="text-balance text-4xl font-semibold tracking-tight md:text-5xl">
          Secure payments & actions for AI agents
        </h1>
        <p className="text-balance text-lg text-zinc-600 dark:text-zinc-400">
          Drop in an API key. Your agent transacts on-chain with built-in
          policy enforcement, anomaly detection, and one-click human
          escalation.{" "}
          <span className="font-medium text-zinc-900 dark:text-zinc-100">
            Stripe-grade DX, non-custodial security.
          </span>
        </p>
        <button
          onClick={onLogin}
          className="rounded-md bg-sky-500 px-6 py-3 text-base font-medium text-white hover:bg-sky-600"
        >
          Sign in to get started
        </button>
      </div>
    </section>
  );
}

type EmbeddedWallet = NonNullable<
  ReturnType<typeof useWallets>["wallets"][number]
>;

function Dashboard({
  email,
  walletAddress,
  embeddedWallet,
}: {
  email: string | null;
  walletAddress: string | null;
  embeddedWallet: EmbeddedWallet | null;
}) {
  return (
    <section className="flex flex-1 flex-col gap-6 px-8 py-10">
      <div className="space-y-1">
        <h2 className="text-2xl font-semibold tracking-tight">
          Welcome{email ? `, ${email}` : ""}
        </h2>
        <p className="text-sm text-zinc-500">
          Your Privy embedded wallet is ready. Next: create your first Agent.
        </p>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Embedded wallet (owner)">
          {walletAddress ? (
            <code className="block break-all rounded bg-zinc-100 px-2 py-1 font-mono text-xs dark:bg-zinc-900">
              {walletAddress}
            </code>
          ) : (
            <span className="text-sm text-zinc-500">Provisioning…</span>
          )}
          <p className="mt-3 text-xs text-zinc-500">
            This wallet is the owner (Validator 1) of every Agent smart
            account you create. Your key stays in Privy&apos;s TEE; the
            backend never sees it.
          </p>
        </Card>

        <CreateAgentCard embeddedWallet={embeddedWallet} />
      </div>
    </section>
  );
}

function CreateAgentCard({
  embeddedWallet,
}: {
  embeddedWallet: EmbeddedWallet | null;
}) {
  const [name, setName] = useState("my-agent");
  const [status, setStatus] = useState<
    "idle" | "provisioning" | "success" | "error"
  >("idle");
  const [agent, setAgent] = useState<ProvisionedAgent | null>(null);
  const [error, setError] = useState<string | null>(null);
  const { signAuthorization } = useSign7702Authorization();

  async function handleCreate() {
    if (!embeddedWallet) return;
    setError(null);
    setStatus("provisioning");
    try {
      const provider = (await embeddedWallet.getEthereumProvider()) as EIP1193Provider;
      const result = await provisionAgent({
        name,
        ownerProvider: provider,
        ownerAddress: embeddedWallet.address as Address,
        signAuthorization: (params) =>
          signAuthorization(params) as Promise<SignAuthorizationReturnType>,
      });
      setAgent(result);
      setStatus("success");
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      setStatus("error");
    }
  }

  return (
    <Card title="Create your first Agent">
      {status === "success" && agent ? (
        <SuccessView agent={agent} />
      ) : (
        <>
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Provision a 7702-delegated smart account + Agent session key.
            You&apos;ll sign one transaction with Privy.
          </p>

          <div className="mt-4 space-y-3">
            <label className="block">
              <span className="block text-xs font-medium uppercase tracking-wide text-zinc-500">
                Agent name
              </span>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                disabled={status === "provisioning"}
                className="mt-1 w-full rounded-md border border-zinc-200 bg-white px-3 py-1.5 text-sm dark:border-zinc-700 dark:bg-zinc-950"
              />
            </label>

            <button
              onClick={handleCreate}
              disabled={
                !embeddedWallet ||
                status === "provisioning" ||
                name.trim().length === 0
              }
              className="rounded-md bg-sky-500 px-4 py-2 text-sm font-medium text-white hover:bg-sky-600 disabled:bg-zinc-300 dark:disabled:bg-zinc-700"
            >
              {status === "provisioning"
                ? "Provisioning… (sign with Privy)"
                : "Create Agent"}
            </button>

            {error && (
              <div className="rounded-md border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900 dark:border-rose-900/50 dark:bg-rose-950/50 dark:text-rose-200">
                <strong className="block font-semibold">
                  Provisioning failed
                </strong>
                <span className="block break-words font-mono">{error}</span>
              </div>
            )}
          </div>
        </>
      )}
    </Card>
  );
}

function SuccessView({ agent }: { agent: ProvisionedAgent }) {
  return (
    <div className="space-y-3 text-sm">
      <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 dark:border-emerald-900/50 dark:bg-emerald-950/50">
        <strong className="block text-xs font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-300">
          Agent ready
        </strong>
        <p className="mt-1 text-zinc-700 dark:text-zinc-300">
          {agent.name}
        </p>
      </div>

      <Field label="API key">
        <code className="block break-all rounded bg-zinc-100 px-2 py-1 font-mono text-xs dark:bg-zinc-900">
          {agent.apiKey}
        </code>
        <p className="mt-1 text-[11px] text-zinc-500">
          Treat this like a Stripe key. We won&apos;t show it again.
        </p>
      </Field>

      <Field label="Smart account">
        <a
          href={`https://sepolia.basescan.org/address/${agent.smartAccountAddress}`}
          target="_blank"
          rel="noreferrer"
          className="block break-all font-mono text-xs text-sky-600 hover:underline dark:text-sky-400"
        >
          {agent.smartAccountAddress}
        </a>
      </Field>

      <Field label="Init transaction">
        <a
          href={`https://sepolia.basescan.org/tx/${agent.initTxHash}`}
          target="_blank"
          rel="noreferrer"
          className="block break-all font-mono text-xs text-sky-600 hover:underline dark:text-sky-400"
        >
          {agent.initTxHash}
        </a>
      </Field>
    </div>
  );
}

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="block text-[11px] font-medium uppercase tracking-wide text-zinc-500">
        {label}
      </span>
      <div className="mt-1">{children}</div>
    </div>
  );
}

function Card({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border border-zinc-200 bg-white p-5 shadow-sm dark:border-zinc-800 dark:bg-zinc-900">
      <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-zinc-500">
        {title}
      </h3>
      {children}
    </div>
  );
}
