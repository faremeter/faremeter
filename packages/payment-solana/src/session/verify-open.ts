import {
  decompileTransactionMessage,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  type Address,
  type Instruction,
} from "@solana/kit";
import { getTransactionDecoder } from "@solana/transactions";

import {
  CREATE_ESCROW_DISCRIMINATOR,
  DEPOSIT_DISCRIMINATOR,
  FLEX_PROGRAM_ADDRESS,
  REGISTER_SESSION_KEY_DISCRIMINATOR,
  findEscrowPda,
  findRegisterSessionKeySessionKeyAccountPda,
  findVaultPda,
} from "@faremeter/flex-solana";

const deriveEscrowAddress = async (args: {
  owner: Address;
  index: bigint;
  programAddress?: Address;
}): Promise<Address> => {
  const [pda] = await findEscrowPda(
    { owner: args.owner, index: args.index },
    args.programAddress !== undefined
      ? { programAddress: args.programAddress }
      : {},
  );
  return pda;
};

const deriveVaultAddress = async (args: {
  escrow: Address;
  mint: Address;
  programAddress?: Address;
}): Promise<Address> => {
  const [pda] = await findVaultPda(
    { escrow: args.escrow, mint: args.mint },
    args.programAddress !== undefined
      ? { programAddress: args.programAddress }
      : {},
  );
  return pda;
};

const deriveSessionKeyAccountAddress = async (args: {
  escrow: Address;
  sessionKey: Address;
  programAddress?: Address;
}): Promise<Address> => {
  const [pda] = await findRegisterSessionKeySessionKeyAccountPda(
    { escrow: args.escrow, sessionKey: args.sessionKey },
    args.programAddress !== undefined
      ? { programAddress: args.programAddress }
      : {},
  );
  return pda;
};

function discriminatorMatches(
  data: Uint8Array | undefined,
  expected: Uint8Array,
): boolean {
  if (!data || data.length < 8) return false;
  for (let i = 0; i < 8; i++) {
    if (data[i] !== expected[i]) return false;
  }
  return true;
}

function readU64LE(data: Uint8Array, offset: number): bigint {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  return view.getBigUint64(offset, true);
}

export type DecodedFlexOpen = {
  owner: Address;
  index: bigint;
  facilitator: Address;
  refundTimeoutSlots: bigint;
  deadmanTimeoutSlots: bigint;
  maxSessionKeys: number;
  escrow: Address;
  mint: Address;
  vault: Address;
  source: Address;
  depositAmount: bigint;
  sessionKey: Address;
  sessionKeyAccount: Address;
  sessionKeyExpiresAtSlot: bigint | null;
  revocationGracePeriodSlots: bigint;
};

export type VerifyFlexOpenTransactionArgs = {
  /** Base64-encoded wire transaction the client supplied. */
  transaction: string;
  /** Channel id the credential claims (escrow PDA, base58). */
  expectedChannelId: Address;
  /** Session key the credential claims (base58 pubkey). */
  expectedSessionKey: Address;
  /** Flex program address. Defaults to the canonical address. */
  programAddress?: Address;
  /**
   * Required fee-payer address per spec §"Settlement Procedure /
   * Open" step 3's sponsored-fees branch. When set, the decoded
   * transaction's fee payer MUST equal this address.
   */
  expectedFeePayer?: Address;
  /**
   * Required payer address per spec §"Settlement Procedure / Open"
   * step 3's non-sponsored branch ("the payer funds the
   * transaction"). When set, the decoded transaction's fee payer
   * MUST equal this address. Mutually exclusive with
   * `expectedFeePayer`.
   */
  expectedPayer?: Address;
  /**
   * Required Flex facilitator key per the challenge's
   * `methodDetails.flex.facilitator`. When set, the `create_escrow`
   * instruction's encoded facilitator MUST equal this address or
   * later Flex settlement will be impossible.
   */
  expectedFacilitator?: Address;
  /**
   * Required refund timeout slots per the challenge's
   * `methodDetails.flex.refundTimeoutSlots`. When set, the decoded
   * `create_escrow` instruction's encoded value MUST equal this.
   */
  expectedRefundTimeoutSlots?: bigint;
  /**
   * Required deadman timeout slots per the challenge's
   * `methodDetails.flex.deadmanTimeoutSlots`. When set, the decoded
   * `create_escrow` instruction's encoded value MUST equal this.
   */
  expectedDeadmanTimeoutSlots?: bigint;
};

export type VerifyFlexOpenResult = {
  decoded: DecodedFlexOpen;
};

/**
 * Decodes a base64-encoded wire transaction and verifies that it
 * contains the three Flex instructions a session-open requires
 * (create_escrow, deposit, register_session_key) targeting the
 * declared channelId and session key. Recomputes the escrow,
 * vault, and session-key-account PDAs from the create_escrow args
 * and verifies the transaction's accounts match.
 *
 * **What this does NOT verify**, per the COMPATIBILITY.md gap list:
 *
 * - The spec PDA seed binding `(payer, payee, asset, signer, salt)`.
 *   Flex's escrow PDA is derived from `(owner, index)` only and does
 *   not bind payee, asset, or signer. We re-derive the Flex PDA and
 *   verify it matches the credential, but the spec MUST that the
 *   PDA bind payee/asset/signer cannot be satisfied without changing
 *   Flex's seed set.
 *
 * - On-chain confirmation. The handler does not currently broadcast
 *   the open transaction or read the channel state back from RPC.
 *   The spec's nine-step open verification (§"Settlement Procedure /
 *   Open") expects post-confirmation reads; this only does the
 *   off-chain pre-broadcast portion.
 */
export async function verifyFlexOpenTransaction(
  args: VerifyFlexOpenTransactionArgs,
): Promise<VerifyFlexOpenResult> {
  const programAddress = args.programAddress ?? FLEX_PROGRAM_ADDRESS;

  if (args.expectedFeePayer !== undefined && args.expectedPayer !== undefined) {
    throw new Error(
      "verifyFlexOpenTransaction: expectedFeePayer and expectedPayer are mutually exclusive",
    );
  }

  const txBytes = getBase64Encoder().encode(args.transaction);
  const decodedTx = getTransactionDecoder().decode(txBytes);
  const compiledMessage = getCompiledTransactionMessageDecoder().decode(
    decodedTx.messageBytes,
  );
  const transactionMessage = decompileTransactionMessage(compiledMessage);

  // Verify the transaction is actually signed by its fee payer.
  // Without this check, an attacker can submit an unsigned open
  // transaction that the handler decodes and persists state from,
  // even though no on-chain program will ever accept it.
  const feePayerAddress = transactionMessage.feePayer?.address;
  if (feePayerAddress === undefined) {
    throw new Error("open transaction has no fee payer set");
  }
  const feePayerSignature = decodedTx.signatures[feePayerAddress];
  if (feePayerSignature === undefined || feePayerSignature === null) {
    throw new Error(
      `open transaction is not signed by its fee payer ${feePayerAddress}`,
    );
  }

  // Spec §"Settlement Procedure / Open" step 3: fee-payer policy.
  // Sponsored-fees branch: fee payer MUST equal facilitatorKey.
  // Non-sponsored branch: fee payer MUST equal the credential's
  // `payer` (the channel owner funds their own open transaction).
  if (args.expectedFeePayer !== undefined) {
    if (feePayerAddress !== args.expectedFeePayer) {
      throw new Error(
        `open transaction fee payer ${feePayerAddress} does not match expected sponsored feePayerKey ${args.expectedFeePayer}`,
      );
    }
  } else if (args.expectedPayer !== undefined) {
    if (feePayerAddress !== args.expectedPayer) {
      throw new Error(
        `open transaction fee payer ${feePayerAddress} does not match expected payer ${args.expectedPayer}`,
      );
    }
  }

  // Spec §"Settlement Procedure / Open" step 4: reject open
  // transactions that carry instructions unrelated to the three
  // Flex instructions a session-open requires. Any other program
  // invocation — including system transfers, memo, compute-budget,
  // or anything else — could redirect funds or change channel state
  // in ways the session handler can't reason about.
  for (const ix of transactionMessage.instructions) {
    if (ix.programAddress !== programAddress) {
      throw new Error(
        `open transaction carries an instruction from unexpected program ${ix.programAddress}; only the Flex program is permitted`,
      );
    }
  }

  const flexInstructions = transactionMessage.instructions.filter(
    (ix): ix is Instruction => ix.programAddress === programAddress,
  );

  const hasDiscriminator = (ix: Instruction, disc: Uint8Array): boolean =>
    discriminatorMatches(ix.data ? new Uint8Array(ix.data) : undefined, disc);

  // Also reject duplicate Flex instructions — per spec step 4, the
  // open transaction MUST contain exactly one create_escrow, one
  // deposit, and one register_session_key. Extras could mutate
  // channel parameters or spawn sibling escrows in the same tx.
  const exactlyOne = (
    discriminator: Uint8Array,
    label: string,
  ): Instruction => {
    const matches = flexInstructions.filter((ix) =>
      hasDiscriminator(ix, discriminator),
    );
    if (matches.length === 0) {
      throw new Error(`open transaction missing ${label} instruction`);
    }
    if (matches.length > 1) {
      throw new Error(
        `open transaction has ${matches.length} ${label} instructions; expected exactly one`,
      );
    }
    const found = matches[0];
    if (!found) {
      throw new Error(`open transaction has unexpected empty ${label} match`);
    }
    return found;
  };

  const createEscrowIx = exactlyOne(
    CREATE_ESCROW_DISCRIMINATOR,
    "create_escrow",
  );
  const depositIx = exactlyOne(DEPOSIT_DISCRIMINATOR, "deposit");
  const registerSessionKeyIx = exactlyOne(
    REGISTER_SESSION_KEY_DISCRIMINATOR,
    "register_session_key",
  );

  // Guard against duplicate instances of ANY Flex discriminator
  // beyond the three recognised ones — a future instruction could
  // bypass these checks if we only filtered by known discriminators.
  if (flexInstructions.length !== 3) {
    throw new Error(
      `open transaction has ${flexInstructions.length} Flex instructions; expected exactly 3 (create_escrow, deposit, register_session_key)`,
    );
  }

  // create_escrow account layout (owner, escrow, systemProgram)
  if (!createEscrowIx.accounts || createEscrowIx.accounts.length < 3) {
    throw new Error("create_escrow has unexpected account count");
  }
  const ownerAccount = createEscrowIx.accounts[0];
  const escrowAccount = createEscrowIx.accounts[1];
  if (!ownerAccount || !escrowAccount) {
    throw new Error("create_escrow accounts missing");
  }
  const owner = ownerAccount.address;
  const escrow = escrowAccount.address;

  // create_escrow data layout: 8(disc) + 8(index) + 32(facilitator) +
  // 8(refund) + 8(deadman) + 1(maxSessionKeys)
  const createData = new Uint8Array(createEscrowIx.data ?? new Uint8Array());
  if (createData.length < 8 + 8 + 32 + 8 + 8 + 1) {
    throw new Error("create_escrow data is too short");
  }
  let off = 8;
  const index = readU64LE(createData, off);
  off += 8;
  const facilitatorBytes = createData.slice(off, off + 32);
  off += 32;
  const refundTimeoutSlots = readU64LE(createData, off);
  off += 8;
  const deadmanTimeoutSlots = readU64LE(createData, off);
  off += 8;
  const maxSessionKeysByte = createData[off];
  if (maxSessionKeysByte === undefined) {
    throw new Error("create_escrow data missing maxSessionKeys");
  }
  const maxSessionKeys = maxSessionKeysByte;

  const decodedFacilitator = bytesToBase58Address(facilitatorBytes);
  if (
    args.expectedFacilitator !== undefined &&
    decodedFacilitator !== args.expectedFacilitator
  ) {
    throw new Error(
      `create_escrow facilitator ${decodedFacilitator} does not match expected ${args.expectedFacilitator}`,
    );
  }
  if (
    args.expectedRefundTimeoutSlots !== undefined &&
    refundTimeoutSlots !== args.expectedRefundTimeoutSlots
  ) {
    throw new Error(
      `create_escrow refundTimeoutSlots ${refundTimeoutSlots} does not match expected ${args.expectedRefundTimeoutSlots}`,
    );
  }
  if (
    args.expectedDeadmanTimeoutSlots !== undefined &&
    deadmanTimeoutSlots !== args.expectedDeadmanTimeoutSlots
  ) {
    throw new Error(
      `create_escrow deadmanTimeoutSlots ${deadmanTimeoutSlots} does not match expected ${args.expectedDeadmanTimeoutSlots}`,
    );
  }

  // Re-derive the escrow PDA from (owner, index) and verify the
  // create_escrow instruction is creating the escrow the credential
  // claims.
  const expectedEscrow = await deriveEscrowAddress({
    owner,
    index,
    programAddress,
  });
  if (expectedEscrow !== escrow) {
    throw new Error(
      `create_escrow account ${escrow} does not match PDA derived from (owner=${owner}, index=${index})`,
    );
  }
  if (escrow !== args.expectedChannelId) {
    throw new Error(
      `create_escrow PDA ${escrow} does not match credential channelId ${args.expectedChannelId}`,
    );
  }

  // deposit account layout (depositor, escrow, mint, vault, source,
  // tokenProgram, systemProgram)
  if (!depositIx.accounts || depositIx.accounts.length < 7) {
    throw new Error("deposit has unexpected account count");
  }
  const depositEscrow = depositIx.accounts[1];
  const mintAccount = depositIx.accounts[2];
  const vaultAccount = depositIx.accounts[3];
  const sourceAccount = depositIx.accounts[4];
  if (!depositEscrow || !mintAccount || !vaultAccount || !sourceAccount) {
    throw new Error("deposit accounts missing");
  }
  const depositEscrowAddress = depositEscrow.address;
  const mint = mintAccount.address;
  const vault = vaultAccount.address;
  const source = sourceAccount.address;

  if (depositEscrowAddress !== escrow) {
    throw new Error(
      `deposit escrow ${depositEscrowAddress} does not match create_escrow ${escrow}`,
    );
  }
  const expectedVault = await deriveVaultAddress({
    escrow,
    mint,
    programAddress,
  });
  if (vault !== expectedVault) {
    throw new Error(
      `deposit vault ${vault} does not match PDA derived from (escrow, mint)`,
    );
  }

  const depositData = new Uint8Array(depositIx.data ?? new Uint8Array());
  if (depositData.length < 8 + 8) {
    throw new Error("deposit data is too short");
  }
  const depositAmount = readU64LE(depositData, 8);

  // register_session_key account layout
  // (owner, escrow, sessionKeyAccount, systemProgram)
  if (
    !registerSessionKeyIx.accounts ||
    registerSessionKeyIx.accounts.length < 4
  ) {
    throw new Error("register_session_key has unexpected account count");
  }
  const rskEscrowAccount = registerSessionKeyIx.accounts[1];
  const sessionKeyAccountMeta = registerSessionKeyIx.accounts[2];
  if (!rskEscrowAccount || !sessionKeyAccountMeta) {
    throw new Error("register_session_key accounts missing");
  }
  const rskEscrow = rskEscrowAccount.address;
  const sessionKeyAccount = sessionKeyAccountMeta.address;
  if (rskEscrow !== escrow) {
    throw new Error(
      `register_session_key escrow ${rskEscrow} does not match create_escrow ${escrow}`,
    );
  }

  // register_session_key data: 8(disc) + 32(sessionKey) +
  // 1+optional 8(expiresAtSlot Option<u64>) + 8(graceSlots)
  const rskData = new Uint8Array(registerSessionKeyIx.data ?? new Uint8Array());
  if (rskData.length < 8 + 32 + 1 + 8) {
    throw new Error("register_session_key data is too short");
  }
  const sessionKeyBytes = rskData.slice(8, 8 + 32);
  let rOff = 8 + 32;
  const expiresPresent = rskData[rOff] === 1;
  rOff += 1;
  let sessionKeyExpiresAtSlot: bigint | null = null;
  if (expiresPresent) {
    if (rskData.length < rOff + 8 + 8) {
      throw new Error(
        "register_session_key data missing expiresAtSlot payload",
      );
    }
    sessionKeyExpiresAtSlot = readU64LE(rskData, rOff);
    rOff += 8;
  }
  if (rskData.length < rOff + 8) {
    throw new Error(
      "register_session_key data missing revocation grace period",
    );
  }
  const revocationGracePeriodSlots = readU64LE(rskData, rOff);

  // Verify the session key bytes match the credential's expectedSessionKey.
  // We compare against the address by re-deriving the PDA.
  const expectedSessionKeyAccount = await deriveSessionKeyAccountAddress({
    escrow,
    sessionKey: args.expectedSessionKey,
    programAddress,
  });
  if (sessionKeyAccount !== expectedSessionKeyAccount) {
    throw new Error(
      `register_session_key account ${sessionKeyAccount} does not match PDA derived from (escrow, expected sessionKey)`,
    );
  }

  return {
    decoded: {
      owner,
      index,
      facilitator: decodedFacilitator,
      refundTimeoutSlots,
      deadmanTimeoutSlots,
      maxSessionKeys,
      escrow,
      mint,
      vault,
      source,
      depositAmount,
      sessionKey: bytesToBase58Address(sessionKeyBytes),
      sessionKeyAccount,
      sessionKeyExpiresAtSlot,
      revocationGracePeriodSlots,
    },
  };
}

import bs58 from "bs58";
function bytesToBase58Address(bytes: Uint8Array): Address {
  return bs58.encode(bytes) as Address;
}
