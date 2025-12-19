import type {
  Commitment,
  Connection,
  PublicKey,
  SendOptions,
  Signer,
  TransactionInstruction,
} from "@solana/web3.js";
import { TransactionMessage, VersionedTransaction } from "@solana/web3.js";
import {
  getSignInstructions,
  getSwigWalletAddress,
  type Swig,
  type SwigOptions,
} from "@swig-wallet/classic";
import { logger } from "./logger";

export interface CreateSwigWalletOptions {
  network: string;
  connection: Connection;
  swig: Swig;
  roleId: number;
  authority: Signer;
  withSubAccount?: boolean;
  payer?: PublicKey;
  swigOptions?: Omit<SwigOptions, "payer" | "currentSlot">;
  refetchBeforeSign?: boolean;
  slotCommitment?: Commitment;
  includeCurrentSlot?: boolean;
  currentSlotProvider?: () => Promise<bigint>;
  sendOptions?: SendOptions;
}

export interface SwigWallet {
  network: string;
  publicKey: PublicKey;
  buildTransaction: (
    instructions: TransactionInstruction[],
    recentBlockhash?: string,
  ) => Promise<VersionedTransaction>;
  sendTransaction: (tx: VersionedTransaction) => Promise<string>;
}

const DEFAULT_COMMITMENT: Commitment = "confirmed";

async function resolveCurrentSlot(args: {
  connection: Connection;
  slotCommitment: Commitment;
  includeCurrentSlot?: boolean;
  currentSlotProvider?: () => Promise<bigint>;
}): Promise<bigint | undefined> {
  if (args.includeCurrentSlot === false) {
    return undefined;
  }

  if (args.currentSlotProvider) {
    return args.currentSlotProvider();
  }

  const slot = await args.connection.getSlot(args.slotCommitment);

  return BigInt(slot);
}

async function resolveRecentBlockhash(
  connection: Connection,
  commitment: Commitment,
  provided?: string,
) {
  if (provided) {
    return provided;
  }

  const { blockhash } = await connection.getLatestBlockhash(commitment);
  return blockhash;
}

export async function createSwigWallet(
  options: CreateSwigWalletOptions,
): Promise<SwigWallet> {
  const {
    network,
    connection,
    swig,
    roleId,
    authority,
    withSubAccount,
    payer,
    swigOptions,
    refetchBeforeSign = true,
    slotCommitment = DEFAULT_COMMITMENT,
    sendOptions,
  } = options;

  const swigWalletAddress = await getSwigWalletAddress(swig);
  const payerPublicKey = payer ?? authority.publicKey;
  const includeCurrentSlot = options.includeCurrentSlot ?? true;

  return {
    network,
    publicKey: swigWalletAddress,
    buildTransaction: async (
      innerInstructions: TransactionInstruction[],
      recentBlockhash?: string,
    ) => {
      if (innerInstructions.length === 0) {
        throw new Error(
          "cannot build a Swig transaction without inner instructions",
        );
      }

      if (refetchBeforeSign) {
        logger.debug("refetching swig {swig}", {
          swig: swig.accountAddress().toBase58(),
        });
        await swig.refetch();
      }

      const currentSlot = await resolveCurrentSlot({
        connection,
        slotCommitment,
        includeCurrentSlot,
        ...(options.currentSlotProvider
          ? { currentSlotProvider: options.currentSlotProvider }
          : {}),
      });

      const swigInvocationOptions: SwigOptions = {
        ...(swigOptions ?? {}),
        payer: payerPublicKey,
      };

      if (currentSlot !== undefined) {
        swigInvocationOptions.currentSlot = currentSlot;
      }

      logger.debug("assembling swig instructions for role {roleId}", {
        roleId,
      });

      const swigInstructions = await getSignInstructions(
        swig,
        roleId,
        innerInstructions,
        withSubAccount,
        swigInvocationOptions,
      );

      const blockhash = await resolveRecentBlockhash(
        connection,
        slotCommitment,
        recentBlockhash,
      );

      const message = new TransactionMessage({
        payerKey: payerPublicKey,
        recentBlockhash: blockhash,
        instructions: swigInstructions,
      }).compileToV0Message();

      const tx = new VersionedTransaction(message);
      tx.sign([authority]);

      logger.info("swig transaction built for role {roleId}", {
        roleId,
      });

      return tx;
    },
    sendTransaction: async (tx: VersionedTransaction) => {
      logger.info("sending swig transaction for role {roleId}", {
        roleId,
      });
      return connection.sendTransaction(tx, {
        preflightCommitment: slotCommitment,
        ...sendOptions,
      });
    },
  };
}
