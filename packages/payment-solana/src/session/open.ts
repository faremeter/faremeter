// Open batch builder: composes the three on-chain steps a session-open
// performs against the Flex escrow program — create_escrow, deposit,
// and register_session_key — into a single instruction array suitable
// for assembly into a versioned transaction message. The underlying
// instruction encoders come from `@faremeter/flex-solana`; this helper
// is Faremeter glue that the session client uses to produce a single
// open transaction.

import type { Address, Instruction, TransactionSigner } from "@solana/kit";

import {
  FLEX_PROGRAM_ADDRESS,
  findEscrowPda,
  findRegisterSessionKeySessionKeyAccountPda,
  findVaultPda,
  getCreateEscrowInstructionAsync,
  getDepositInstructionAsync,
  getRegisterSessionKeyInstructionAsync,
} from "@faremeter/flex-solana";

export type BuildSessionOpenInstructionsArgs = {
  owner: TransactionSigner;
  facilitator: Address;
  sessionKey: Address;
  mint: Address;
  source: Address;
  index: bigint;
  depositAmount: bigint;
  refundTimeoutSlots: bigint;
  deadmanTimeoutSlots: bigint;
  maxSessionKeys: number;
  sessionKeyExpiresAtSlot: bigint | null;
  sessionKeyGracePeriodSlots: bigint;
  programAddress?: Address;
};

export type SessionOpenInstructions = {
  instructions: [Instruction, Instruction, Instruction];
  escrow: Address;
  vault: Address;
  sessionKeyAccount: Address;
};

/**
 * Returns the three-instruction batch that opens a Flex session.
 * The caller is responsible for assembling the instructions into a
 * versioned transaction message, signing, and submitting.
 */
export async function buildSessionOpenInstructions(
  args: BuildSessionOpenInstructionsArgs,
): Promise<SessionOpenInstructions> {
  const programAddress = args.programAddress ?? FLEX_PROGRAM_ADDRESS;
  const programConfig = { programAddress };

  // Re-derive the PDAs the three instructions will reference. The
  // generated `getCreateEscrowInstructionAsync` etc. helpers also
  // accept these as optional fields and derive them when omitted, but
  // we want the addresses returned to the caller alongside the
  // instructions so the session handler can echo them in its
  // credential.
  const [escrow] = await findEscrowPda(
    { owner: args.owner.address, index: args.index },
    programConfig,
  );
  const [vault] = await findVaultPda(
    { escrow, mint: args.mint },
    programConfig,
  );
  const [sessionKeyAccount] = await findRegisterSessionKeySessionKeyAccountPda(
    { escrow, sessionKey: args.sessionKey },
    programConfig,
  );

  const createEscrow = await getCreateEscrowInstructionAsync(
    {
      owner: args.owner,
      escrow,
      index: args.index,
      facilitator: args.facilitator,
      refundTimeoutSlots: args.refundTimeoutSlots,
      deadmanTimeoutSlots: args.deadmanTimeoutSlots,
      maxSessionKeys: args.maxSessionKeys,
    },
    programConfig,
  );

  const deposit = await getDepositInstructionAsync(
    {
      depositor: args.owner,
      escrow,
      mint: args.mint,
      vault,
      source: args.source,
      amount: args.depositAmount,
    },
    programConfig,
  );

  const registerSessionKey = await getRegisterSessionKeyInstructionAsync(
    {
      owner: args.owner,
      escrow,
      sessionKeyAccount,
      sessionKey: args.sessionKey,
      expiresAtSlot: args.sessionKeyExpiresAtSlot,
      revocationGracePeriodSlots: args.sessionKeyGracePeriodSlots,
    },
    programConfig,
  );

  return {
    instructions: [createEscrow, deposit, registerSessionKey],
    escrow,
    vault,
    sessionKeyAccount,
  };
}
