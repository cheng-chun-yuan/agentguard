import {
  AgentGuardError,
  type AgentGuardConfig,
  type TransferOptions,
  type TxResult,
} from "./types";

export {
  AgentGuardError,
  type AgentGuardConfig,
  type TransferOptions,
  type TxResult,
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
