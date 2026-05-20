"use client";

import { PrivyProvider } from "@privy-io/react-auth";
import { baseSepolia } from "viem/chains";

export function Providers({ children }: { children: React.ReactNode }) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;

  if (!appId) {
    return (
      <div className="flex flex-1 items-center justify-center p-8 font-mono text-sm">
        <div className="max-w-lg space-y-3 rounded-lg border border-amber-400/30 bg-amber-50 p-6 dark:bg-amber-950/30">
          <h2 className="text-lg font-semibold text-amber-900 dark:text-amber-100">
            Missing NEXT_PUBLIC_PRIVY_APP_ID
          </h2>
          <p className="text-amber-800 dark:text-amber-200">
            Create an app at{" "}
            <a
              href="https://dashboard.privy.io"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              dashboard.privy.io
            </a>
            , then copy <code>.env.local.example</code> to{" "}
            <code>.env.local</code> and paste the App ID.
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
          theme: "light",
          accentColor: "#0EA5E9",
          logo: undefined,
        },
        loginMethods: ["email", "wallet", "passkey"],
        embeddedWallets: {
          ethereum: {
            createOnLogin: "users-without-wallets",
          },
        },
        defaultChain: baseSepolia,
        supportedChains: [baseSepolia],
      }}
    >
      {children}
    </PrivyProvider>
  );
}
