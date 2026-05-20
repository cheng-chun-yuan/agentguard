"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { baseSepolia } from "viem/chains";

export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) {
    return (
      <div className="flex flex-1 items-center justify-center p-8">
        <div className="max-w-xl border border-[var(--color-border)] bg-[var(--color-bg-elev)] p-6 font-mono text-sm">
          <div className="text-[10px] uppercase tracking-[0.2em] text-[var(--color-fg-dim)]">
            missing config
          </div>
          <h2 className="mt-2 font-display text-lg text-[var(--color-fg)]">
            NEXT_PUBLIC_PRIVY_APP_ID is not set
          </h2>
          <p className="mt-3 text-[var(--color-fg-muted)]">
            Create an app at{" "}
            <a
              href="https://dashboard.privy.io"
              target="_blank"
              rel="noreferrer"
              className="text-[var(--color-accent)] underline decoration-dotted underline-offset-4"
            >
              dashboard.privy.io
            </a>{" "}
            and add the App ID to{" "}
            <code className="text-[var(--color-fg)]">apps/dashboard/.env.local</code>.
          </p>
        </div>
      </div>
    );
  }

  return (
    <PrivyProvider
      appId={appId}
      config={{
        appearance: {
          theme: "dark",
          accentColor: "#e2a32a",
          logo: undefined,
        },
        loginMethods: ["email", "wallet", "passkey"],
        embeddedWallets: {
          ethereum: { createOnLogin: "users-without-wallets" },
        },
        defaultChain: baseSepolia,
        supportedChains: [baseSepolia],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
