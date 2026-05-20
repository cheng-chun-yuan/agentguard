import {
  AgentGuardError,
  type AgentGuardConfig,
  type ChatMessage,
  type IntentContext,
  type TransferOptions,
  type TxResult,
  type X402PaymentRequirement,
  type X402Response,
  type X402Settlement,
} from "./types";

export {
  AgentGuardError,
  type AgentGuardConfig,
  type ChatMessage,
  type IntentContext,
  type TransferOptions,
  type TxResult,
  type X402PaymentRequirement,
  type X402Response,
  type X402Settlement,
};

const DEFAULT_BASE_URL = "http://localhost:3737"; // backend default; dashboard runs on :4000

/**
 * AgentGuard SDK — a thin client that lets your AI Agent transact on-chain
 * through a policy-enforced, non-custodial smart account.
 *
 * @example
 *   const guard = new AgentGuard({ apiKey: 'ag_test_...' })
 *   const result = await guard.transfer({
 *     to: '0x...',
 *     token: 'USDC',
 *     amount: '0.001',
 *   })
 *   console.log(result.txHash)
 */
export class AgentGuard {
  private readonly apiKey: string;
  private readonly baseUrl: string;

  constructor(config: AgentGuardConfig) {
    if (!config.apiKey) throw new Error("AgentGuard: apiKey is required");
    this.apiKey = config.apiKey;
    this.baseUrl = (config.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, "");
  }

  /**
   * Execute an ERC-20 transfer through the Agent's session key.
   *
   * On-chain policy caps single-transfer value. Requests above the cap
   * (or off-whitelist targets) revert at the validator stage — fail fast,
   * no funds at risk.
   */
  async transfer(options: TransferOptions): Promise<TxResult> {
    return this.request<TxResult>("/transfer", options);
  }

  /**
   * `fetch` with HTTP 402 support — the agent transparently pays for any
   * resource that advertises x402 payment requirements, then retries with
   * the `X-PAYMENT` header. Micropayments stay within the session-key
   * cap so the AI Detect / policy escalation paths are not triggered.
   *
   * Hard rule: if the resource asks for *more* than what the agent's
   * session key is permitted to spend, the underlying transfer falls
   * back to GUARD/HUMAN and `fetch` throws — *no* over-policy payment
   * is ever attempted under the user's nose.
   */
  async fetch(input: string, init?: RequestInit): Promise<Response> {
    const first = await fetch(input, init);
    if (first.status !== 402) return first;

    const requirements = await parseX402(first);
    if (!requirements) {
      // Server returned 402 without proper x402 metadata — surface as-is
      return first;
    }

    const decimals = requirements.extra?.decimals ?? 6;
    const humanAmount = atomicToHuman(requirements.maxAmountRequired, decimals);
    const tokenSym = (requirements.extra?.name ?? "USDC").toUpperCase();
    if (tokenSym !== "USDC") {
      throw new AgentGuardError(
        `x402 asset ${tokenSym} not supported in this SDK version (USDC only)`,
        400,
      );
    }

    const result = await this.transfer({
      to: requirements.payTo,
      token: "USDC",
      amount: humanAmount,
    });

    if (result.status !== "submitted") {
      throw new AgentGuardError(
        `x402 payment for ${input} bounced to ${result.tier.toUpperCase()} tier — not retrying`,
        402,
      );
    }

    const settlement: X402Settlement = {
      x402Version: 1,
      scheme: "settled",
      network: requirements.network,
      payload: {
        txHash: result.txHash,
        from: "0x0000000000000000000000000000000000000000",
        to: requirements.payTo,
        value: requirements.maxAmountRequired,
        asset: requirements.asset,
      },
    };

    const headers = new Headers(init?.headers ?? {});
    headers.set("X-PAYMENT", encodeBase64(JSON.stringify(settlement)));

    return fetch(input, { ...init, headers });
  }

  private async request<T>(path: string, body: unknown): Promise<T> {
    const res = await fetch(`${this.baseUrl}${path}`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    let parsed: unknown = undefined;
    try {
      parsed = text ? JSON.parse(text) : undefined;
    } catch {
      /* leave parsed undefined */
    }

    if (!res.ok) {
      const message =
        parsed && typeof parsed === "object" && parsed !== null && "error" in parsed
          ? String((parsed as { error: unknown }).error)
          : text || res.statusText;
      throw new AgentGuardError(message, res.status);
    }

    return parsed as T;
  }
}

// ── x402 helpers ────────────────────────────────────────────────────

async function parseX402(
  res: Response,
): Promise<X402PaymentRequirement | null> {
  let body: X402Response | undefined;
  try {
    body = (await res.clone().json()) as X402Response;
  } catch {
    return null;
  }
  if (!body || !Array.isArray(body.accepts) || body.accepts.length === 0)
    return null;
  return body.accepts[0]!;
}

function atomicToHuman(atomic: string, decimals: number): string {
  // Avoid bigint stringify edge-cases — accept either decimal or bigint string.
  const value = BigInt(atomic);
  const whole = value / 10n ** BigInt(decimals);
  const fraction = value % 10n ** BigInt(decimals);
  const fracStr = fraction.toString().padStart(decimals, "0").replace(/0+$/, "");
  return fracStr ? `${whole}.${fracStr}` : `${whole}`;
}

function encodeBase64(s: string): string {
  // Bun/Node 18+ and modern browsers all expose `btoa`.
  return typeof btoa === "function"
    ? btoa(s)
    : Buffer.from(s, "utf8").toString("base64");
}
