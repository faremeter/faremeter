import type {
  MPPPaymentHandler,
  MPPPaymentExecer,
  mppChallengeParams,
  mppCredential,
} from "@faremeter/types/mpp";
import { decodeBase64URL } from "@faremeter/types/mpp";
import { isValidationError } from "@faremeter/types";
import {
  fetchMint,
  findAssociatedTokenPda,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import { getTransferSolInstruction } from "@solana-program/system";
import {
  address,
  createNoopSigner,
  getBase64EncodedWireTransaction,
  type Address,
  type Blockhash,
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
import { mppChargeRequest } from "./common";
import { toAddress, toRpc } from "../compat";

async function broadcastAndConfirm(
  tx: Transaction,
  wallet: Wallet,
  rpc: Rpc<SolanaRpcApi>,
  challenge: mppChallengeParams,
  md: mppChargeRequest["methodDetails"],
  lifetimeConstraint: WalletLifetimeConstraint,
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

  // Poll until the signature is confirmed or the blockhash expires.
  const maxPolls = 60;
  let confirmed = false;
  for (let i = 0; i < maxPolls; i++) {
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
    if (
      lifetimeConstraint.lastValidBlockHeight > 0n &&
      currentHeight > lifetimeConstraint.lastValidBlockHeight
    ) {
      throw new Error("blockhash expired before confirmation");
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
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
): Promise<WalletLifetimeConstraint> {
  if (supplied) {
    return {
      blockhash: supplied as Blockhash,
      lastValidBlockHeight: 0n,
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

export type CreateMPPSolanaChargeClientArgs = {
  wallet: Wallet;
  mint: Address | { toBase58(): string };
  rpc?: Rpc<SolanaRpcApi> | string;
  tokenProgramId?: Address | { toBase58(): string };
  broadcast?: boolean;
};

export function createMPPSolanaChargeClient(
  args: CreateMPPSolanaChargeClientArgs,
): MPPPaymentHandler {
  const mint = toAddress(args.mint);
  const defaultTokenProgram = args.tokenProgramId
    ? toAddress(args.tokenProgramId)
    : undefined;
  const rpc = args.rpc ? toRpc(args.rpc) : undefined;
  const { wallet, broadcast = false } = args;

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

    return {
      challenge,
      exec: async (): Promise<mppCredential> => {
        const md = request.methodDetails;
        const amount = BigInt(request.amount);
        const recipientKey = address(request.recipient);
        const feePayerKey =
          md?.feePayer === true && md.feePayerKey
            ? address(md.feePayerKey)
            : undefined;

        const lifetimeConstraint = await fetchLifetimeConstraint(
          rpc,
          md?.recentBlockhash,
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

        const tokenProgramId: Address = md?.tokenProgram
          ? address(md.tokenProgram)
          : (defaultTokenProgram ?? TOKEN_PROGRAM_ADDRESS);

        const [sourceAccount] = await findAssociatedTokenPda({
          mint,
          owner: wallet.publicKey,
          tokenProgram: tokenProgramId,
        });

        const [receiverAccount] = await findAssociatedTokenPda({
          mint,
          owner: recipientKey,
          tokenProgram: tokenProgramId,
        });

        const walletSigner = createNoopSigner(wallet.publicKey);

        const instructions: Instruction[] = [
          getSetComputeUnitLimitInstruction({ units: 200_000 }),
          getSetComputeUnitPriceInstruction({ microLamports: 1n }),
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
        ];

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
};

export function createMPPSolanaNativeChargeClient(
  args: CreateMPPSolanaNativeChargeClientArgs,
): MPPPaymentHandler {
  const rpc = args.rpc ? toRpc(args.rpc) : undefined;
  const { wallet, broadcast = false } = args;

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

    return {
      challenge,
      exec: async (): Promise<mppCredential> => {
        const md = request.methodDetails;
        const amount = BigInt(request.amount);
        const recipientKey = address(request.recipient);
        const feePayerKey =
          md?.feePayer === true && md.feePayerKey
            ? address(md.feePayerKey)
            : undefined;

        const lifetimeConstraint = await fetchLifetimeConstraint(
          rpc,
          md?.recentBlockhash,
        );

        const walletSigner = createNoopSigner(wallet.publicKey);

        const instructions: Instruction[] = [
          getSetComputeUnitLimitInstruction({ units: 200_000 }),
          getSetComputeUnitPriceInstruction({ microLamports: 1n }),
          getTransferSolInstruction({
            source: walletSigner,
            destination: recipientKey,
            amount,
          }),
        ];

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
