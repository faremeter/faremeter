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
  AccountRole,
  createNoopSigner,
  createSolanaRpc,
  type Address,
  type Instruction,
  type AccountMeta,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import {
  getBase64EncodedWireTransaction,
  type SignaturesMap,
  type TransactionMessageBytes,
} from "@solana/transactions";
import {
  PublicKey,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  Keypair,
} from "@solana/web3.js";
import { PaymentRequirementsExtra } from "./facilitator";
import { generateMatcher } from "./common";
import { createMemoInstruction, generateMemoNonce } from "./memo";
import { logger } from "./logger";

export type Wallet = {
  network: string | SolanaCAIP2Network;
  publicKey: PublicKey;
  buildTransaction?: (
    instructions: TransactionInstruction[],
    recentBlockHash: string,
  ) => Promise<VersionedTransaction>;
  partiallySignTransaction?: (
    tx: VersionedTransaction,
  ) => Promise<VersionedTransaction>;
  updateTransaction?: (
    tx: VersionedTransaction,
  ) => Promise<VersionedTransaction>;
  sendTransaction?: (tx: VersionedTransaction) => Promise<string>;
};

export function toTransactionInstruction(
  ix: Instruction & { accounts?: readonly AccountMeta[] },
) {
  return new TransactionInstruction({
    programId: new PublicKey(ix.programAddress),
    keys: (ix.accounts ?? []).map((a) => ({
      pubkey: new PublicKey(a.address),
      isSigner:
        a.role === AccountRole.READONLY_SIGNER ||
        a.role === AccountRole.WRITABLE_SIGNER,
      isWritable:
        a.role === AccountRole.WRITABLE ||
        a.role === AccountRole.WRITABLE_SIGNER,
    })),
    data: ix.data ? Buffer.from(ix.data) : Buffer.alloc(0),
  });
}

const PaymentMode = {
  ToSpec: "toSpec",
  SettlementAccount: "settlementAccount",
} as const;

type PaymentMode = (typeof PaymentMode)[keyof typeof PaymentMode];

async function extractMetadata(args: {
  rpc: Rpc<SolanaRpcApi> | undefined;
  mintAddress: Address;
  requirements: x402PaymentRequirements;
  options: CreatePaymentHandlerOptions | undefined;
  wallet: Wallet;
}) {
  const { rpc, mintAddress, requirements, wallet, options } = args;

  const extra = PaymentRequirementsExtra(requirements.extra);

  if (isValidationError(extra)) {
    throwValidationError("couldn't validate requirements extra field", extra);
  }

  let recentBlockhash: string;
  if (extra.recentBlockhash !== undefined) {
    recentBlockhash = extra.recentBlockhash;
  } else if (rpc !== undefined) {
    recentBlockhash = (await rpc.getLatestBlockhash().send()).value.blockhash;
  } else {
    throw new Error("couldn't get the latest Solana network block hash");
  }

  let decimals: number;
  if (extra.decimals !== undefined) {
    decimals = extra.decimals;
  } else if (rpc !== undefined) {
    const mintInfo = await fetchMint(rpc, mintAddress);
    decimals = mintInfo.data.decimals;
  } else {
    throw new Error("couldn't get the decimal information for the mint");
  }

  const payerKey = new PublicKey(extra.feePayer);
  const payTo = new PublicKey(requirements.payTo);
  const amount = Number(requirements.amount);
  let paymentMode: PaymentMode = PaymentMode.ToSpec;

  if (
    options?.features?.enableSettlementAccounts &&
    extra.features?.xSettlementAccountSupported &&
    wallet.sendTransaction
  ) {
    paymentMode = PaymentMode.SettlementAccount;
  }

  const tokenProgram = extra.tokenProgram
    ? address(extra.tokenProgram)
    : TOKEN_PROGRAM_ADDRESS;

  const memo = extra.memo;

  return {
    recentBlockhash,
    decimals,
    payTo,
    amount,
    payerKey,
    paymentMode,
    tokenProgram,
    memo,
  };
}

interface CreatePaymentHandlerOptions {
  rpc?: Rpc<SolanaRpcApi>;
  settlementRentDestination?: string;
  features?: {
    enableSettlementAccounts?: boolean;
  };
}

function isConnection(value: unknown): value is { rpcEndpoint: string } {
  return (
    typeof value === "object" &&
    value !== null &&
    "rpcEndpoint" in value &&
    typeof (value as { rpcEndpoint: unknown }).rpcEndpoint === "string"
  );
}

/**
 * Creates a payment handler for the Solana exact payment scheme.
 *
 * The handler builds SPL token transfer transactions that can be signed
 * and submitted by the client to fulfill x402 payment requirements.
 *
 * @param wallet - Wallet providing signing capabilities
 * @param mint - SPL token mint public key
 * @param options - Optional configuration including RPC fallback and features
 * @returns A PaymentHandler function for use with the x402 client
 */
/** @deprecated Pass `{ rpc }` in options instead of a Connection */
export function createPaymentHandler(
  wallet: Wallet,
  mint: PublicKey,
  connection: { rpcEndpoint: string },
  options?: CreatePaymentHandlerOptions,
): PaymentHandler;
export function createPaymentHandler(
  wallet: Wallet,
  mint: PublicKey,
  options?: CreatePaymentHandlerOptions,
): PaymentHandler;
export function createPaymentHandler(
  wallet: Wallet,
  mint: PublicKey,
  connectionOrOptions?: { rpcEndpoint: string } | CreatePaymentHandlerOptions,
  legacyOptions?: CreatePaymentHandlerOptions,
): PaymentHandler {
  let options: CreatePaymentHandlerOptions | undefined;

  if (isConnection(connectionOrOptions)) {
    logger.warning(
      "createPaymentHandler: passing a Connection as the third argument is deprecated. " +
        "Pass { rpc: createSolanaRpc(url) } in options instead.",
    );
    options = {
      ...legacyOptions,
      rpc: createSolanaRpc(connectionOrOptions.rpcEndpoint),
    };
  } else {
    options = connectionOrOptions;
  }
  let hasWarnedAboutDeprecation = false;

  const signTransaction = async (tx: VersionedTransaction) => {
    if (wallet.partiallySignTransaction) {
      return wallet.partiallySignTransaction(tx);
    }
    if (wallet.updateTransaction) {
      if (!hasWarnedAboutDeprecation) {
        logger.warning(
          "wallet.partiallySignTransaction is not available, falling back to updateTransaction",
        );
        hasWarnedAboutDeprecation = true;
      }
      return wallet.updateTransaction(tx);
    }
    return tx;
  };

  const { isMatchingRequirement } = generateMatcher(
    wallet.network,
    mint ? mint.toBase58() : "sol",
  );

  const mintAddress = address(mint.toBase58());

  return async (
    _context: RequestContext,
    accepts: x402PaymentRequirements[],
  ): Promise<PaymentExecer[]> => {
    const compatibleRequirements = accepts.filter(isMatchingRequirement);
    const res = compatibleRequirements.map((requirements) => {
      const exec = async () => {
        const {
          recentBlockhash,
          decimals,
          payTo,
          amount,
          payerKey,
          paymentMode,
          tokenProgram,
          memo,
        } = await extractMetadata({
          rpc: options?.rpc,
          mintAddress,
          requirements,
          wallet,
          options,
        });

        const walletSigner = createNoopSigner(
          address(wallet.publicKey.toBase58()),
        );

        const instructions = [
          toTransactionInstruction(
            getSetComputeUnitLimitInstruction({ units: 50_000 }),
          ),
          toTransactionInstruction(
            getSetComputeUnitPriceInstruction({ microLamports: 1n }),
          ),
        ];

        const [sourceAccount] = await findAssociatedTokenPda({
          mint: mintAddress,
          owner: address(wallet.publicKey.toBase58()),
          tokenProgram,
        });

        switch (paymentMode) {
          case PaymentMode.ToSpec: {
            const [receiverAccount] = await findAssociatedTokenPda({
              mint: mintAddress,
              owner: address(payTo.toBase58()),
              tokenProgram,
            });

            instructions.push(
              toTransactionInstruction(
                getTransferCheckedInstruction(
                  {
                    source: sourceAccount,
                    mint: mintAddress,
                    destination: receiverAccount,
                    authority: walletSigner,
                    amount: BigInt(amount),
                    decimals,
                  },
                  { programAddress: tokenProgram },
                ),
              ),
              createMemoInstruction(memo ?? generateMemoNonce()),
            );

            let tx: VersionedTransaction;

            if (wallet.buildTransaction) {
              tx = await wallet.buildTransaction(instructions, recentBlockhash);
            } else {
              const message = new TransactionMessage({
                instructions,
                payerKey,
                recentBlockhash,
              }).compileToV0Message();

              tx = new VersionedTransaction(message);
            }

            tx = await signTransaction(tx);

            const base64EncodedWireTransaction =
              getBase64EncodedWireTransaction({
                messageBytes:
                  tx.message.serialize() as unknown as TransactionMessageBytes,
                signatures: tx.signatures as unknown as SignaturesMap,
              });

            const payload = {
              transaction: base64EncodedWireTransaction,
            };

            return { payload };
          }

          case PaymentMode.SettlementAccount: {
            const settleKeypair = Keypair.generate();
            const [settleATA] = await findAssociatedTokenPda({
              mint: mintAddress,
              owner: address(settleKeypair.publicKey.toBase58()),
              tokenProgram,
            });

            instructions.push(
              toTransactionInstruction(
                getCreateAssociatedTokenIdempotentInstruction({
                  payer: walletSigner,
                  ata: settleATA,
                  owner: address(settleKeypair.publicKey.toBase58()),
                  mint: mintAddress,
                  tokenProgram,
                }),
              ),
              toTransactionInstruction(
                getTransferCheckedInstruction(
                  {
                    source: sourceAccount,
                    mint: mintAddress,
                    destination: settleATA,
                    authority: walletSigner,
                    amount: BigInt(amount),
                    decimals,
                  },
                  { programAddress: tokenProgram },
                ),
              ),
            );

            let tx: VersionedTransaction;

            if (wallet.buildTransaction) {
              tx = await wallet.buildTransaction(instructions, recentBlockhash);
            } else {
              const message = new TransactionMessage({
                instructions,
                payerKey,
                recentBlockhash,
              }).compileToV0Message();

              tx = new VersionedTransaction(message);
            }

            tx = await signTransaction(tx);

            if (!wallet.sendTransaction) {
              throw new Error(
                "wallet must support sending transactions to use settlement accounts with exact",
              );
            }

            const transactionSignature = await wallet.sendTransaction(tx);

            const settleSecretKey = Buffer.from(
              settleKeypair.secretKey,
            ).toString("base64");

            const settlementRentDestination =
              options?.settlementRentDestination ?? wallet.publicKey.toBase58();

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
