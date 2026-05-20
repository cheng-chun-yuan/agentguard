import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages are bare TypeScript — let Next.js transpile them.
  transpilePackages: ["@agentguard/sdk"],
};

export default nextConfig;
