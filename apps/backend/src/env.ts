import type { Hex } from "viem";

const required = (key: string): string => {
  const v = process.env[key];
  if (!v) throw new Error(`Missing env: ${key}`);
  return v;
};

export const env = {
  PORT: Number(process.env.PORT ?? 3001),
  ZERODEV_RPC: required("ZERODEV_RPC"),
  BASE_SEPOLIA_RPC: required("BASE_SEPOLIA_RPC"),
  DEV_OWNER_PRIVATE_KEY: required("DEV_OWNER_PRIVATE_KEY") as Hex,
  DB_PATH: process.env.DB_PATH ?? "./agentguard.db",
  DASHBOARD_ORIGIN: process.env.DASHBOARD_ORIGIN ?? "http://localhost:3000",
};
