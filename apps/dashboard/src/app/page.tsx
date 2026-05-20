"use client";

import { usePrivy, useWallets } from "@privy-io/react-auth";

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

function Dashboard({
  email,
  walletAddress,
}: {
  email: string | null;
  walletAddress: string | null;
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
            This wallet will become the owner (Validator 1) of every Agent
            smart account you create. Your key stays in Privy&apos;s TEE; the
            backend never sees it.
          </p>
        </Card>

        <Card title="Create your first Agent">
          <p className="text-sm text-zinc-600 dark:text-zinc-400">
            Sign a single transaction to provision a 7702-delegated smart
            account + Agent session key. Coming next in M1.4.2.
          </p>
          <button
            disabled
            className="mt-4 rounded-md bg-zinc-200 px-4 py-2 text-sm font-medium text-zinc-500 dark:bg-zinc-800 dark:text-zinc-500"
          >
            Create Agent (coming soon)
          </button>
        </Card>
      </div>
    </section>
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
