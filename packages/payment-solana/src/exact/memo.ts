import { PublicKey, TransactionInstruction } from "@solana/web3.js";
import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";

export function generateMemoNonce(): string {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export function createMemoInstruction(memo: string): TransactionInstruction {
  return new TransactionInstruction({
    programId: new PublicKey(MEMO_PROGRAM_ADDRESS),
    keys: [],
    data: Buffer.from(memo, "utf-8"),
  });
}
