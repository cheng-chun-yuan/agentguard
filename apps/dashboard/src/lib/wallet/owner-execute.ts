/**
 * Owner-path execute — used by the dashboard when an approval cleared.
 *
 * For HUMAN-tier transfers, the on-chain session-key validator would
 * revert (the cap is 0.005 USDC). The owner (Privy embedded wallet)
 * holds the sudo plugin and has no policy limit, so we route through
 * sudo here. ZeroDev sees the EOA is already 7702-delegated (its code
 * starts with `0xef0100…`) and skips re-signing the authorization.
 */

import {
  createKernelAccount,
  createKernelAccountClient,
  createZeroDevPaymasterClient,
} from "@zerodev/sdk";
import { signerToEcdsaValidator } from "@zerodev/ecdsa-validator";
import {
  createWalletClient,
  custom,
  encodeFunctionData,
  http,
  parseUnits,
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
import { getZeroDevRpc, publicClient } from "./clients";

type Token = "USDC";

const TOKEN_REGISTRY: Record<Token, { address: Address; decimals: number }> = {
  USDC: { address: USDC_ADDRESS, decimals: 6 },
};

export type OwnerExecuteInput = {
  ownerProvider: EIP1193Provider;
  ownerAddress: Address;
  to: Address;
  token: Token;
  amount: string;
};

export type OwnerExecuteResult = {
  userOpHash: Hex;
  txHash: Hex;
};

export async function executeAsOwner(
  input: OwnerExecuteInput,
): Promise<OwnerExecuteResult> {
  const token = TOKEN_REGISTRY[input.token];
  if (!token) throw new Error(`Unsupported token: ${input.token}`);

  const ownerWalletClient = createWalletClient({
    account: input.ownerAddress,
    chain,
    transport: custom(input.ownerProvider),
  });

  // Sudo validator backed by the Privy owner. ZeroDev will route through
  // this validator since `regular` is omitted.
  const sudoValidator = await signerToEcdsaValidator(publicClient, {
    signer: ownerWalletClient,
    entryPoint,
    kernelVersion,
  });

  // Account is already 7702-delegated; no eip7702Auth needed. We still
  // pass eip7702Account so ZeroDev derives accountAddress = EOA address.
  const account = await createKernelAccount(publicClient, {
    plugins: { sudo: sudoValidator },
    entryPoint,
    kernelVersion,
    eip7702Account: ownerWalletClient,
  } as Parameters<typeof createKernelAccount>[1]);

  const ZERODEV_RPC = getZeroDevRpc();
  const paymasterClient = createZeroDevPaymasterClient({
    chain,
    transport: http(ZERODEV_RPC),
  });

  const client = createKernelAccountClient({
    account,
    chain,
    bundlerTransport: http(ZERODEV_RPC),
    paymaster: paymasterClient,
  });

  const amountWei = parseUnits(input.amount, token.decimals);
  const callData = await account.encodeCalls([
    {
      to: token.address,
      value: 0n,
      data: encodeFunctionData({
        abi: ERC20_TRANSFER_ABI,
        functionName: "transfer",
        args: [input.to, amountWei],
      }),
    },
  ]);

  const userOpHash = await client.sendUserOperation({ callData });
  const receipt = await client.waitForUserOperationReceipt({ hash: userOpHash });
  return {
    userOpHash,
    txHash: receipt.receipt.transactionHash as Hex,
  };
}
