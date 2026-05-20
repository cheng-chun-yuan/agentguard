import { createPublicClient, http } from "viem";
import { chain } from "./constants";

const ZERODEV_RPC = process.env.NEXT_PUBLIC_ZERODEV_RPC;

if (!ZERODEV_RPC) {
  // Surfaces lazily on first call — provider page also shows a friendly empty
  // state. Throwing here would crash the whole app on import.
  console.warn(
    "[wallet] NEXT_PUBLIC_ZERODEV_RPC is not set — provisioning will fail.",
  );
}

export const publicClient = createPublicClient({
  chain,
  transport: http(),
});

export function getZeroDevRpc(): string {
  const url = process.env.NEXT_PUBLIC_ZERODEV_RPC;
  if (!url)
    throw new Error(
      "NEXT_PUBLIC_ZERODEV_RPC env var is required for provisioning. " +
        "Set it in apps/dashboard/.env.local.",
    );
  return url;
}

export function getBackendUrl(): string {
  return (
    process.env.NEXT_PUBLIC_BACKEND_URL?.replace(/\/+$/, "") ??
    "http://localhost:3737"
  );
}
