import type {
  TransactionMessage,
  TransactionMessageWithFeePayer,
  TransactionMessageWithLifetime,
} from "@solana/kit";

/**
 * A transaction message with everything required to be compiled and landed
 * on the network: a fee payer and a lifetime constraint.
 *
 * `@solana/transaction-messages` used to expose this exact intersection as
 * `CompilableTransactionMessage`. The named alias was removed in 6.x but the
 * constituent types are still exported, so we re-declare it locally with the
 * same shape.
 */
export type CompilableTransactionMessage = TransactionMessage &
  TransactionMessageWithFeePayer &
  TransactionMessageWithLifetime;
