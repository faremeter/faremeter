import type {
  MPPPaymentHandler,
  MPPPaymentExecer,
  mppChallengeParams,
  mppCredential,
} from "@faremeter/types/mpp";
import { decodeBase64URL } from "@faremeter/types/mpp";
import { isValidationError } from "@faremeter/types";
import { caip2ToCluster, normalizeNetworkId } from "@faremeter/info/solana";
import {
  getCreateAssociatedTokenIdempotentInstruction,
  fetchMint,
  findAssociatedTokenPda,
  getTransferCheckedInstruction,
} from "@solana-program/token";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { getAddMemoInstruction } from "@solana-program/memo";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  address,
  createNoopSigner,
  getBase64EncodedWireTransaction,
  isBlockhash,
  type Address,
  type Instruction,
  type Rpc,
  type Signature,
  type SolanaRpcApi,
  type Transaction,
} from "@solana/kit";
import {
  buildAndSignClientTransaction,
  type Wallet,
  type WalletLifetimeConstraint,
} from "../exact/client";
import {
  chargeHasATACreationSplits,
  getChargeChallengeMemo,
  getChargeMemoValidationError,
  getChargePrimaryAmount,
  getChargeSplits,
  mppChargeRequest,
} from "./common";
import { toAddress, toRpc } from "../compat";

type AddressInput = Address | { toBase58(): string };
type AmountInput = string | bigint;

export type MPPSolanaChargeClientExpectedSplit = {
  amount: AmountInput;
  recipient: AddressInput;
  memo?: string;
  ataCreationRequired?: boolean;
};

export type MPPSolanaChargeClientExpected = {
  amount?: AmountInput;
  recipient?: AddressInput;
  network?: string;
  feePayerKey?: AddressInput | null;
  splits?: readonly MPPSolanaChargeClientExpectedSplit[];
};

type NormalizedChargeClientExpectedSplit = {
  amount: string;
  recipient: Address;
  memo: string | undefined;
  ataCreationRequired: boolean;
};

type NormalizedChargeClientExpected = {
  amount: string | undefined;
  recipient: Address | undefined;
  network: string | undefined;
  feePayerKey: Address | null | undefined;
  splits: readonly NormalizedChargeClientExpectedSplit[] | undefined;
};

type ChargeLifetimeConstraint = WalletLifetimeConstraint & {
  fallbackLastValidBlockHeight?: bigint;
};

type ChargeBroadcastConfirmOpts = {
  maxRetries: number;
  retryDelayMs: number;
};

const SERVER_BLOCKHASH_FALLBACK_VALIDITY_BLOCKS = 150n;
const DEFAULT_BROADCAST_MAX_RETRIES = 60;
const DEFAULT_BROADCAST_RETRY_DELAY_MS = 1000;

async function broadcastAndConfirm(
  tx: Transaction,
  wallet: Wallet,
  rpc: Rpc<SolanaRpcApi>,
  challenge: mppChallengeParams,
  md: mppChargeRequest["methodDetails"],
  lifetimeConstraint: ChargeLifetimeConstraint,
  opts: ChargeBroadcastConfirmOpts,
): Promise<mppCredential> {
  if (md?.feePayer) {
    throw new Error("push mode is not allowed with fee sponsorship");
  }

  let signature: string;
  if (wallet.sendTransaction) {
    signature = await wallet.sendTransaction(tx);
  } else {
    const wire = getBase64EncodedWireTransaction(tx);
    signature = await rpc.sendTransaction(wire, { encoding: "base64" }).send();
  }

  let confirmed = false;
  for (let i = 0; i < opts.maxRetries; i++) {
    const status = await rpc
      .getSignatureStatuses([signature as Signature])
      .send();
    if (status.value[0]?.err) {
      throw new Error(
        `transaction failed: ${JSON.stringify(status.value[0].err)}`,
      );
    }
    if (
      status.value[0]?.confirmationStatus === "confirmed" ||
      status.value[0]?.confirmationStatus === "finalized"
    ) {
      confirmed = true;
      break;
    }
    const currentHeight = await rpc.getBlockHeight().send();
    const lastValidBlockHeight =
      lifetimeConstraint.lastValidBlockHeight > 0n
        ? lifetimeConstraint.lastValidBlockHeight
        : lifetimeConstraint.fallbackLastValidBlockHeight;
    if (
      lastValidBlockHeight !== undefined &&
      currentHeight > lastValidBlockHeight
    ) {
      throw new Error("blockhash expired before confirmation");
    }
    await new Promise((resolve) => setTimeout(resolve, opts.retryDelayMs));
  }

  if (!confirmed) {
    throw new Error("transaction confirmation timed out");
  }

  return {
    challenge,
    payload: { type: "signature", signature },
  };
}

async function fetchLifetimeConstraint(
  rpc: Rpc<SolanaRpcApi> | undefined,
  supplied: string | undefined,
  verifySuppliedFreshness: boolean,
): Promise<ChargeLifetimeConstraint> {
  if (supplied) {
    if (!isBlockhash(supplied)) {
      throw new Error("invalid recentBlockhash");
    }
    if (!verifySuppliedFreshness) {
      return {
        blockhash: supplied,
        lastValidBlockHeight: 0n,
      };
    }
    if (!rpc) {
      throw new Error("rpc is required to verify recentBlockhash");
    }
    const [{ value: isValid }, currentHeight] = await Promise.all([
      rpc.isBlockhashValid(supplied).send(),
      rpc.getBlockHeight().send(),
    ]);
    if (!isValid) {
      throw new Error("recentBlockhash is no longer valid");
    }
    return {
      blockhash: supplied,
      lastValidBlockHeight: 0n,
      fallbackLastValidBlockHeight:
        currentHeight + SERVER_BLOCKHASH_FALLBACK_VALIDITY_BLOCKS,
    };
  }
  if (!rpc) {
    throw new Error("no blockhash available");
  }
  const { value } = await rpc.getLatestBlockhash().send();
  return {
    blockhash: value.blockhash,
    lastValidBlockHeight: value.lastValidBlockHeight,
  };
}

function getOptionalChargeMemo(request: mppChargeRequest): string | undefined {
  const memo = getChargeChallengeMemo(request);
  if (memo === undefined || memo.length === 0) {
    return undefined;
  }
  const error = getChargeMemoValidationError(memo);
  if (error) throw new Error(error);
  return memo;
}

function addMemoInstruction(
  instructions: Instruction[],
  memo: string | undefined,
) {
  if (memo === undefined || memo.length === 0) return;
  const error = getChargeMemoValidationError(memo);
  if (error) throw new Error(error);
  instructions.push(getAddMemoInstruction({ memo }));
}

function normalizeChargeAmount(amount: AmountInput): string {
  if (typeof amount === "bigint") return amount.toString();
  return amount;
}

function getNetworkString(network: Wallet["network"] | undefined) {
  if (network === undefined) return undefined;
  if (typeof network === "string") return network;
  return network.caip2;
}

function normalizeChargeNetwork(network: Wallet["network"] | undefined) {
  const rawNetwork = getNetworkString(network) ?? "mainnet";
  const normalizedNetwork = normalizeNetworkId(rawNetwork);
  const cluster = caip2ToCluster(normalizedNetwork) ?? normalizedNetwork;
  if (cluster === "mainnet-beta") return "mainnet";
  return cluster;
}

function normalizeChargeClientExpected(
  expected: MPPSolanaChargeClientExpected | undefined,
): NormalizedChargeClientExpected {
  if (!expected) {
    return {
      amount: undefined,
      recipient: undefined,
      network: undefined,
      feePayerKey: undefined,
      splits: undefined,
    };
  }
  return {
    amount:
      expected.amount === undefined
        ? undefined
        : normalizeChargeAmount(expected.amount),
    recipient:
      expected.recipient === undefined
        ? undefined
        : toAddress(expected.recipient),
    network:
      expected.network === undefined
        ? undefined
        : normalizeChargeNetwork(expected.network),
    feePayerKey:
      expected.feePayerKey === undefined || expected.feePayerKey === null
        ? expected.feePayerKey
        : toAddress(expected.feePayerKey),
    splits: expected.splits?.map((split) => ({
      amount: normalizeChargeAmount(split.amount),
      recipient: toAddress(split.recipient),
      memo: split.memo,
      ataCreationRequired: split.ataCreationRequired === true,
    })),
  };
}

function getChargeFeePayerKey(request: mppChargeRequest): string | null {
  const methodDetails = request.methodDetails;
  if (methodDetails?.feePayer !== true) return null;
  return methodDetails.feePayerKey ?? null;
}

function getChargeClientValidationError(
  request: mppChargeRequest,
  walletNetwork: Wallet["network"],
  expected: NormalizedChargeClientExpected,
) {
  if (
    normalizeChargeNetwork(request.methodDetails?.network) !==
    normalizeChargeNetwork(walletNetwork)
  ) {
    return "charge network does not match wallet network";
  }
  if (expected.amount !== undefined && request.amount !== expected.amount) {
    return "charge amount does not match expected amount";
  }
  if (
    expected.recipient !== undefined &&
    request.recipient !== expected.recipient
  ) {
    return "charge recipient does not match expected recipient";
  }
  if (
    expected.network !== undefined &&
    normalizeChargeNetwork(request.methodDetails?.network) !== expected.network
  ) {
    return "charge network does not match expected network";
  }
  if (
    expected.feePayerKey !== undefined &&
    getChargeFeePayerKey(request) !== expected.feePayerKey
  ) {
    return "charge fee payer does not match expected fee payer";
  }
  if (expected.splits !== undefined) {
    const splits = getChargeSplits(request);
    if (splits.length !== expected.splits.length) {
      return "charge splits do not match expected splits";
    }
    for (let i = 0; i < splits.length; i++) {
      const split = splits[i];
      const expectedSplit = expected.splits[i];
      if (!split || !expectedSplit) {
        return "charge splits do not match expected splits";
      }
      if (
        split.amount !== expectedSplit.amount ||
        split.recipient !== expectedSplit.recipient ||
        split.memo !== expectedSplit.memo ||
        (split.ataCreationRequired === true) !==
          expectedSplit.ataCreationRequired
      ) {
        return "charge splits do not match expected splits";
      }
    }
  }
  return null;
}

export type CreateMPPSolanaChargeClientArgs = {
  wallet: Wallet;
  mint: Address | { toBase58(): string };
  rpc?: Rpc<SolanaRpcApi> | string;
  broadcast?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
  expected?: MPPSolanaChargeClientExpected;
};

export function createMPPSolanaChargeClient(
  args: CreateMPPSolanaChargeClientArgs,
): MPPPaymentHandler {
  const mint = toAddress(args.mint);
  const rpc = args.rpc ? toRpc(args.rpc) : undefined;
  const {
    wallet,
    broadcast = false,
    maxRetries = DEFAULT_BROADCAST_MAX_RETRIES,
    retryDelayMs = DEFAULT_BROADCAST_RETRY_DELAY_MS,
  } = args;
  const expected = normalizeChargeClientExpected(args.expected);

  if (broadcast && !rpc) {
    throw new Error("rpc is required when broadcast is true");
  }

  return async (
    challenge: mppChallengeParams,
  ): Promise<MPPPaymentExecer | null> => {
    if (challenge.method !== "solana") return null;
    if (challenge.intent !== "charge") return null;

    let requestBody: unknown;
    try {
      requestBody = JSON.parse(decodeBase64URL(challenge.request));
    } catch {
      return null;
    }

    const request = mppChargeRequest(requestBody);
    if (isValidationError(request)) return null;
    if (request.currency === "sol") return null;
    if (request.currency !== mint) return null;
    if (getChargeClientValidationError(request, wallet.network, expected)) {
      return null;
    }

    return {
      challenge,
      exec: async (): Promise<mppCredential> => {
        const md = request.methodDetails;
        const memo = getOptionalChargeMemo(request);
        const primaryAmount = getChargePrimaryAmount(request);
        const splits = getChargeSplits(request);
        const feePayerKey =
          md?.feePayer === true && md.feePayerKey
            ? address(md.feePayerKey)
            : undefined;

        const lifetimeConstraint = await fetchLifetimeConstraint(
          rpc,
          md?.recentBlockhash,
          broadcast,
        );

        let decimals: number;
        if (md?.decimals !== undefined) {
          decimals = md.decimals;
        } else if (rpc) {
          const mintInfo = await fetchMint(rpc, mint);
          decimals = mintInfo.data.decimals;
        } else {
          throw new Error("no decimals available");
        }

        let tokenProgramId: Address;
        if (md?.tokenProgram !== undefined) {
          tokenProgramId = address(md.tokenProgram);
        } else {
          if (!rpc) {
            throw new Error("rpc is required when tokenProgram is absent");
          }
          // Servers should include tokenProgram; this lookup is required by
          // the spec when it is omitted, but adds an RPC round trip.
          const mintInfo = await fetchMint(rpc, mint);
          tokenProgramId = mintInfo.programAddress;
        }

        const [sourceAccount] = await findAssociatedTokenPda({
          mint,
          owner: wallet.publicKey,
          tokenProgram: tokenProgramId,
        });

        const walletSigner = createNoopSigner(wallet.publicKey);

        const instructions: Instruction[] = [
          getSetComputeUnitLimitInstruction({ units: 200_000 }),
          getSetComputeUnitPriceInstruction({ microLamports: 1n }),
        ];
        const addTransfer = async (
          recipient: string,
          amount: bigint,
          createATA: boolean,
        ) => {
          const recipientKey = address(recipient);
          const [receiverAccount] = await findAssociatedTokenPda({
            mint,
            owner: recipientKey,
            tokenProgram: tokenProgramId,
          });
          if (createATA) {
            instructions.push(
              getCreateAssociatedTokenIdempotentInstruction({
                ata: receiverAccount,
                owner: recipientKey,
                payer: feePayerKey
                  ? createNoopSigner(feePayerKey)
                  : walletSigner,
                mint,
                tokenProgram: tokenProgramId,
              }),
            );
          }
          instructions.push(
            getTransferCheckedInstruction(
              {
                source: sourceAccount,
                mint,
                destination: receiverAccount,
                authority: walletSigner,
                amount,
                decimals,
              },
              { programAddress: tokenProgramId },
            ),
          );
        };

        await addTransfer(request.recipient, primaryAmount, false);
        addMemoInstruction(instructions, memo);

        for (const split of splits) {
          // Without a fee payer the wallet pays the rent, so it creates every
          // split's ATA; with a sponsor, only the splits the server flagged.
          await addTransfer(
            split.recipient,
            BigInt(split.amount),
            feePayerKey ? split.ataCreationRequired === true : true,
          );
          addMemoInstruction(instructions, split.memo);
        }

        const payerKey = feePayerKey ?? wallet.publicKey;

        const tx = await buildAndSignClientTransaction(
          wallet,
          instructions,
          payerKey,
          lifetimeConstraint,
        );

        if (broadcast) {
          if (!rpc) throw new Error("rpc is required");
          return broadcastAndConfirm(
            tx,
            wallet,
            rpc,
            challenge,
            md,
            lifetimeConstraint,
            { maxRetries, retryDelayMs },
          );
        }

        return {
          challenge,
          payload: {
            type: "transaction",
            transaction: getBase64EncodedWireTransaction(tx),
          },
        };
      },
    };
  };
}

export type CreateMPPSolanaNativeChargeClientArgs = {
  wallet: Wallet;
  rpc?: Rpc<SolanaRpcApi> | string;
  broadcast?: boolean;
  maxRetries?: number;
  retryDelayMs?: number;
  expected?: MPPSolanaChargeClientExpected;
};

export function createMPPSolanaNativeChargeClient(
  args: CreateMPPSolanaNativeChargeClientArgs,
): MPPPaymentHandler {
  const rpc = args.rpc ? toRpc(args.rpc) : undefined;
  const {
    wallet,
    broadcast = false,
    maxRetries = DEFAULT_BROADCAST_MAX_RETRIES,
    retryDelayMs = DEFAULT_BROADCAST_RETRY_DELAY_MS,
  } = args;
  const expected = normalizeChargeClientExpected(args.expected);

  if (broadcast && !rpc) {
    throw new Error("rpc is required when broadcast is true");
  }

  return async (
    challenge: mppChallengeParams,
  ): Promise<MPPPaymentExecer | null> => {
    if (challenge.method !== "solana") return null;
    if (challenge.intent !== "charge") return null;

    let requestBody: unknown;
    try {
      requestBody = JSON.parse(decodeBase64URL(challenge.request));
    } catch {
      return null;
    }

    const request = mppChargeRequest(requestBody);
    if (isValidationError(request)) return null;
    if (request.currency !== "sol") return null;
    if (getChargeClientValidationError(request, wallet.network, expected)) {
      return null;
    }

    return {
      challenge,
      exec: async (): Promise<mppCredential> => {
        const md = request.methodDetails;
        const memo = getOptionalChargeMemo(request);
        const primaryAmount = getChargePrimaryAmount(request);
        const splits = getChargeSplits(request);
        if (chargeHasATACreationSplits(request)) {
          throw new Error("ataCreationRequired requires an SPL token charge");
        }
        const feePayerKey =
          md?.feePayer === true && md.feePayerKey
            ? address(md.feePayerKey)
            : undefined;

        const lifetimeConstraint = await fetchLifetimeConstraint(
          rpc,
          md?.recentBlockhash,
          broadcast,
        );

        const walletSigner = createNoopSigner(wallet.publicKey);

        const instructions: Instruction[] = [
          getSetComputeUnitLimitInstruction({ units: 200_000 }),
          getSetComputeUnitPriceInstruction({ microLamports: 1n }),
          getTransferSolInstruction({
            source: walletSigner,
            destination: address(request.recipient),
            amount: primaryAmount,
          }),
        ];
        addMemoInstruction(instructions, memo);

        for (const split of splits) {
          instructions.push(
            getTransferSolInstruction({
              source: walletSigner,
              destination: address(split.recipient),
              amount: BigInt(split.amount),
            }),
          );
          addMemoInstruction(instructions, split.memo);
        }

        const payerKey = feePayerKey ?? wallet.publicKey;

        const tx = await buildAndSignClientTransaction(
          wallet,
          instructions,
          payerKey,
          lifetimeConstraint,
        );

        if (broadcast) {
          if (!rpc) throw new Error("rpc is required");
          return broadcastAndConfirm(
            tx,
            wallet,
            rpc,
            challenge,
            md,
            lifetimeConstraint,
            { maxRetries, retryDelayMs },
          );
        }

        return {
          challenge,
          payload: {
            type: "transaction",
            transaction: getBase64EncodedWireTransaction(tx),
          },
        };
      },
    };
  };
}
