/**
 * Emergency Stop — sweep all USDC out of the agent's smart account via
 * an owner-signed UserOp, then mark the agent as revoked on the backend.
 *
 * Why sweep instead of uninstalling the validator: the Kernel uninstall
 * call (`uninstallValidation`) requires reconstructing the exact ValidationId
 * + deinit data the validator was installed with. Doable but fiddly. Sweep
 * is the practical defense — once the account is empty, the leaked session
 * key has nothing to drain, even before its 24h TimestampPolicy kicks in.
 */

import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import {
  createPublicClient,
  createWalletClient,
  custom,
  encodeFunctionData,
  formatUnits,
  http,
  type Address,
  type EIP1193Provider,
  type Hex,
} from "viem";

import {
  ERC20_TRANSFER_ABI,
  USDC_ADDRESS,
  chain,
  entryPoint,
  kernelVersion,
} from "./constants";
import { getBackendUrl, getZeroDevRpc } from "./clients";

const ERC20_BALANCE_ABI = [
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ type: "uint256" }],
  },
] as const;

export type RevokeResult = {
  swept: boolean;
  amountUsdc: string;
  txHash?: Hex;
  userOpHash?: Hex;
};

export async function revokeAgent(input: {
  agentId: string;
  ownerProvider: EIP1193Provider;
  ownerAddress: Address;
  smartAccountAddress: Address;
}): Promise<RevokeResult> {
  // ── (1) Read smart account's USDC balance ──
  const reader = createPublicClient({ chain, transport: http() });
  const balance = (await reader.readContract({
    address: USDC_ADDRESS,
    abi: ERC20_BALANCE_ABI,
    functionName: "balanceOf",
    args: [input.smartAccountAddress],
  })) as bigint;

  const amountUsdc = formatUnits(balance, 6);

  // ── (2) If anything to sweep, build + send the owner-signed UserOp ──
  let txHash: Hex | undefined;
  let userOpHash: Hex | undefined;

  if (balance > 0n) {
    const ownerWalletClient = createWalletClient({
      account: input.ownerAddress,
      chain,
      transport: custom(input.ownerProvider),
    });
    const sudoValidator = await signerToEcdsaValidator(reader, {
      signer: ownerWalletClient,
      entryPoint,
      kernelVersion,
    });
    const account = await createKernelAccount(reader, {
      plugins: { sudo: sudoValidator },
      entryPoint,
      kernelVersion,
      eip7702Account: ownerWalletClient,
    } as Parameters<typeof createKernelAccount>[1]);

    const ZERODEV_RPC = getZeroDevRpc();
    const paymaster = createZeroDevPaymasterClient({
      chain,
      transport: http(ZERODEV_RPC),
    });
    const client = createKernelAccountClient({
      account,
      chain,
      bundlerTransport: http(ZERODEV_RPC),
      paymaster,
    });

    const callData = await account.encodeCalls([
      {
        to: USDC_ADDRESS,
        value: 0n,
        data: encodeFunctionData({
          abi: ERC20_TRANSFER_ABI,
          functionName: "transfer",
          args: [input.ownerAddress, balance],
        }),
      },
    ]);

    userOpHash = await client.sendUserOperation({ callData });
    const receipt = await client.waitForUserOperationReceipt({
      hash: userOpHash,
    });
    txHash = receipt.receipt.transactionHash as Hex;
  }

  // ── (3) Tell the backend the agent is revoked ──
  const res = await fetch(`${getBackendUrl()}/agents/${input.agentId}/revoke`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sweepTxHash: txHash,
      userOpHash,
      sweptAmount: amountUsdc,
      reason:
        balance > 0n
          ? `swept ${amountUsdc} USDC to owner`
          : "agent revoked (no USDC to sweep)",
    }),
  });
  if (!res.ok) {
    throw new Error(
      `backend revoke failed (${res.status}): ${await res.text()}`,
    );
  }

  return {
    swept: balance > 0n,
    amountUsdc,
    txHash,
    userOpHash,
  };
}
