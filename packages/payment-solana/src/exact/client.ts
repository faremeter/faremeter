import type { x402PaymentRequirements } from "@faremeter/types/x402v2";
import { isValidationError, throwValidationError } from "@faremeter/types";
import type {
  PaymentExecer,
  PaymentHandler,
  RequestContext,
} from "@faremeter/types/client";
import type { SolanaCAIP2Network } from "@faremeter/info/solana";
import {
  fetchMint,
  findAssociatedTokenPda,
  getCreateAssociatedTokenIdempotentInstruction,
  getTransferCheckedInstruction,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  getSetComputeUnitLimitInstruction,
  getSetComputeUnitPriceInstruction,
} from "@solana-program/compute-budget";
import {
  address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createKeyPairFromPrivateKeyBytes,
  createKeyPairSignerFromBytes,
  createNoopSigner,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type Address,
  type Blockhash,
  type Instruction,
  type Rpc,
  type SolanaRpcApi,
  type Transaction,
} from "@solana/kit";
import { PaymentRequirementsExtra } from "./facilitator";
import { generateMatcher } from "./common";
import { generateMemoNonce } from "./memo";
import { getAddMemoInstruction } from "@solana-program/memo";

export type WalletLifetimeConstraint = {
  blockhash: Blockhash;
  lastValidBlockHeight: bigint;
};

export type Wallet = {
  network: string | SolanaCAIP2Network;
  publicKey: Address;
  buildTransaction?: (
    instructions: readonly Instruction[],
    lifetimeConstraint: WalletLifetimeConstraint,
  ) => Promise<Transaction>;
  partiallySignTransaction?: (tx: Transaction) => Promise<Transaction>;
  sendTransaction?: (tx: Transaction) => Promise<string>;
};

const PaymentMode = {
  ToSpec: "toSpec",
  SettlementAccount: "settlementAccount",
} as const;

type PaymentMode = (typeof PaymentMode)[keyof typeof PaymentMode];

async function extractMetadata(args: {
  rpc: Rpc<SolanaRpcApi> | undefined;
  mint: Address;
  requirements: x402PaymentRequirements;
  options: CreatePaymentHandlerOptions | undefined;
  wallet: Wallet;
}) {
  const { rpc, mint, requirements, wallet, options } = args;

  const extra = PaymentRequirementsExtra(requirements.extra);

  if (isValidationError(extra)) {
    throwValidationError("couldn't validate requirements extra field", extra);
  }

  let lifetimeConstraint: WalletLifetimeConstraint;
  if (extra.recentBlockhash !== undefined) {
    // The server supplied a blockhash but no lastValidBlockHeight. Kit
    // requires both; use a sentinel lastValidBlockHeight of 0n since it
    // only affects client-side retry timing, not wire format.
    lifetimeConstraint = {
      blockhash: extra.recentBlockhash as Blockhash,
      lastValidBlockHeight: 0n,
    };
  } else if (rpc !== undefined) {
    const { value } = await rpc.getLatestBlockhash().send();
    lifetimeConstraint = {
      blockhash: value.blockhash,
      lastValidBlockHeight: value.lastValidBlockHeight,
    };
  } else {
    throw new Error("couldn't get the latest Solana network block hash");
  }

  let decimals: number;
  if (extra.decimals !== undefined) {
    decimals = extra.decimals;
  } else if (rpc !== undefined) {
    const mintInfo = await fetchMint(rpc, mint);
    decimals = mintInfo.data.decimals;
  } else {
    throw new Error("couldn't get the decimal information for the mint");
  }

  const payerKey = address(extra.feePayer);
  const payTo = address(requirements.payTo);
  const amount = Number(requirements.amount);
  let paymentMode: PaymentMode = PaymentMode.ToSpec;

  if (
    options?.features?.enableSettlementAccounts &&
    extra.features?.xSettlementAccountSupported &&
    wallet.sendTransaction
  ) {
    paymentMode = PaymentMode.SettlementAccount;
  }

  const tokenProgramId: Address = extra.tokenProgram
    ? address(extra.tokenProgram)
    : (options?.token?.programId ?? TOKEN_PROGRAM_ADDRESS);

  const memo = extra.memo;

  return {
    lifetimeConstraint,
    decimals,
    payTo,
    amount,
    payerKey,
    paymentMode,
    tokenProgramId,
    memo,
  };
}

interface CreatePaymentHandlerOptions {
  token?: {
    programId?: Address;
  };
  settlementRentDestination?: string;
  features?: {
    enableSettlementAccounts?: boolean;
  };
}

export async function buildAndSignClientTransaction(
  wallet: Wallet,
  instructions: readonly Instruction[],
  payerKey: Address,
  lifetimeConstraint: WalletLifetimeConstraint,
): Promise<Transaction> {
  const sign = async (tx: Transaction): Promise<Transaction> => {
    if (wallet.partiallySignTransaction) {
      return wallet.partiallySignTransaction(tx);
    }
    return tx;
  };

  let tx: Transaction;
  if (wallet.buildTransaction) {
    tx = await wallet.buildTransaction(instructions, lifetimeConstraint);
  } else {
    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(payerKey, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(lifetimeConstraint, m),
      (m) => appendTransactionMessageInstructions(instructions, m),
    );
    tx = compileTransaction(message);
  }

  return sign(tx);
}

async function generateSettleSigner() {
  // Build a fresh ed25519 keypair locally and also return its wire-format
  // bytes (32-byte privkey || 32-byte pubkey) so the facilitator can
  // reconstruct the signer on settlement via createKeyPairSignerFromBytes.
  const privateKeyBytes = crypto.getRandomValues(new Uint8Array(32));
  // @solana/keys' CryptoKeyPair is returned here; the lib in our tsconfig
  // doesn't include DOM types so we widen to a minimal local shape.
  const keyPair = (await createKeyPairFromPrivateKeyBytes(
    privateKeyBytes,
    /* extractable */ true,
  )) as { publicKey: Parameters<typeof crypto.subtle.exportKey>[1] };

  const publicKeyBytes = new Uint8Array(
    await crypto.subtle.exportKey("raw", keyPair.publicKey),
  );
  const secretKey = new Uint8Array(64);
  secretKey.set(privateKeyBytes);
  secretKey.set(publicKeyBytes, 32);
  const signer = await createKeyPairSignerFromBytes(secretKey);
  return { signer, secretKey };
}

/**
 * Creates a payment handler for the Solana exact payment scheme.
 *
 * The handler builds SPL token transfer transactions that can be signed
 * and submitted by the client to fulfill x402 payment requirements.
 *
 * @param wallet - Wallet providing signing capabilities
 * @param mint - SPL token mint address
 * @param rpc - Optional Solana RPC client for fetching blockhash and mint info
 * @param options - Optional configuration for token address and features
 * @returns A PaymentHandler function for use with the x402 client
 */
export function createPaymentHandler(
  wallet: Wallet,
  mint: Address,
  rpc?: Rpc<SolanaRpcApi>,
  options?: CreatePaymentHandlerOptions,
): PaymentHandler {
  const { isMatchingRequirement } = generateMatcher(wallet.network, mint);

  return async (
    _context: RequestContext,
    accepts: x402PaymentRequirements[],
  ): Promise<PaymentExecer[]> => {
    const compatibleRequirements = accepts.filter(isMatchingRequirement);
    const res = compatibleRequirements.map((requirements) => {
      const exec = async () => {
        const {
          lifetimeConstraint,
          decimals,
          payTo,
          amount,
          payerKey,
          paymentMode,
          tokenProgramId,
          memo,
        } = await extractMetadata({
          rpc,
          mint,
          requirements,
          wallet,
          options,
        });

        const baseInstructions: Instruction[] = [
          getSetComputeUnitLimitInstruction({ units: 50_000 }),
          getSetComputeUnitPriceInstruction({ microLamports: 1n }),
        ];

        const walletSigner = createNoopSigner(wallet.publicKey);

        const [sourceAccount] = await findAssociatedTokenPda({
          mint,
          owner: wallet.publicKey,
          tokenProgram: tokenProgramId,
        });

        switch (paymentMode) {
          case PaymentMode.ToSpec: {
            const [receiverAccount] = await findAssociatedTokenPda({
              mint,
              owner: payTo,
              tokenProgram: tokenProgramId,
            });

            const instructions: Instruction[] = [
              ...baseInstructions,
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
              getAddMemoInstruction({ memo: memo ?? generateMemoNonce() }),
            ];

            const tx = await buildAndSignClientTransaction(
              wallet,
              instructions,
              payerKey,
              lifetimeConstraint,
            );

            const payload = {
              transaction: getBase64EncodedWireTransaction(tx),
            };

            return { payload };
          }

          case PaymentMode.SettlementAccount: {
            const { signer: settleSigner, secretKey: settleSecretBytes } =
              await generateSettleSigner();

            const [settleATA] = await findAssociatedTokenPda({
              mint,
              owner: settleSigner.address,
              tokenProgram: tokenProgramId,
            });

            const instructions: Instruction[] = [
              ...baseInstructions,
              getCreateAssociatedTokenIdempotentInstruction({
                ata: settleATA,
                owner: settleSigner.address,
                payer: walletSigner,
                mint,
                tokenProgram: tokenProgramId,
              }),
              getTransferCheckedInstruction(
                {
                  source: sourceAccount,
                  mint,
                  destination: settleATA,
                  authority: walletSigner,
                  amount,
                  decimals,
                },
                { programAddress: tokenProgramId },
              ),
            ];

            const tx = await buildAndSignClientTransaction(
              wallet,
              instructions,
              payerKey,
              lifetimeConstraint,
            );

            if (!wallet.sendTransaction) {
              throw new Error(
                "wallet must support sending transactions to use settlement accounts with exact",
              );
            }

            const transactionSignature = await wallet.sendTransaction(tx);

            const settleSecretKey =
              Buffer.from(settleSecretBytes).toString("base64");

            const settlementRentDestination =
              options?.settlementRentDestination ?? wallet.publicKey;

            const payload = {
              settleSecretKey,
              transactionSignature,
              settlementRentDestination,
            };

            return { payload };
          }
        }
      };

      return {
        exec,
        requirements,
      };
    });

    return res;
  };
}
