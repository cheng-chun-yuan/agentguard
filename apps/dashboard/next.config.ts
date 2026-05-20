import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Workspace packages are bare TypeScript — let Next.js transpile them.
  transpilePackages: ["@agentguard/sdk"],
  // Allow the Cloudflare tunnel hostname to access dev resources (HMR, _next/*).
  // Without this, the page renders but client-side JS can't bootstrap.
  allowedDevOrigins: ["agentguard.polyoctant.com"],
};

export default nextConfig;
