/**
 * Minimal x402 resource server for demo purposes.
 *
 * GET /forecast
 *   - no X-PAYMENT header → 402 with x402 payment requirements
 *   - with valid X-PAYMENT → 200 with weather data
 *
 * "Valid" here = structurally well-formed Settlement JSON whose txHash
 * hasn't been redeemed yet in this process. Production servers would
 * verify the on-chain receipt + the from/to/value against requirements.
 */

import { serve } from "bun";
type BunServer = ReturnType<typeof serve>;

// "0xc0ffee" recipient — represents the API provider. Address is all
// lowercase so it bypasses EIP-55 checksum validation in viem.
const PAY_TO: `0x${string}` = "0x000000000000000000000000000000000000c0fe";
const USDC_BASE_SEPOLIA: `0x${string}` =
  "0x036CbD53842c5426634e7929541eC2318f3dCF7e";
const PRICE_ATOMIC = "1000"; // 0.001 USDC
const PORT = Number(process.env.X402_PORT ?? 4242);

const redeemed = new Set<string>();

function paymentRequirements() {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "settled",
        network: "base-sepolia",
        maxAmountRequired: PRICE_ATOMIC,
        resource: `http://localhost:${PORT}/forecast`,
        description: "Today's weather forecast (demo)",
        mimeType: "application/json",
        payTo: PAY_TO,
        maxTimeoutSeconds: 60,
        asset: USDC_BASE_SEPOLIA,
        extra: { name: "USDC", version: "2", decimals: 6 },
      },
    ],
    error: "Payment required",
  };
}

export function startServer(): BunServer {
  return serve({
    port: PORT,
    fetch(req) {
      const url = new URL(req.url);

      if (url.pathname !== "/forecast") {
        return new Response("not found", { status: 404 });
      }

      const xPayment = req.headers.get("X-PAYMENT");
      if (!xPayment) {
        return Response.json(paymentRequirements(), { status: 402 });
      }

      let settlement: { payload?: { txHash?: string; to?: string; value?: string } };
      try {
        const decoded = atob(xPayment);
        settlement = JSON.parse(decoded);
      } catch {
        return Response.json(
          { error: "malformed X-PAYMENT header" },
          { status: 400 },
        );
      }

      const txHash = settlement?.payload?.txHash;
      if (!txHash || !/^0x[a-fA-F0-9]{64}$/.test(txHash)) {
        return Response.json(
          { error: "X-PAYMENT missing or malformed txHash" },
          { status: 400 },
        );
      }
      if (redeemed.has(txHash)) {
        return Response.json(
          { error: "txHash already redeemed" },
          { status: 409 },
        );
      }
      redeemed.add(txHash);

      // Production: verify the on-chain receipt here.
      return Response.json({
        forecast: pickWeather(),
        timestamp: Date.now(),
        paidWith: txHash,
      });
    },
  });
}

const FORECASTS = [
  "Sunny, 72°F",
  "Partly cloudy, 68°F",
  "Light rain, 61°F",
  "Thunderstorms, 58°F",
  "Snow, 28°F",
];

function pickWeather(): string {
  return FORECASTS[Math.floor(Math.random() * FORECASTS.length)]!;
}

// Allow running this file standalone.
if (import.meta.main) {
  const s = startServer();
  console.log(`🌤️  x402 demo server listening on http://localhost:${s.port}`);
}
