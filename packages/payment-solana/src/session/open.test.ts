#!/usr/bin/env pnpm tsx

import t from "tap";
import { address, generateKeyPairSigner, AccountRole } from "@solana/kit";
import {
  FLEX_PROGRAM_ADDRESS,
  CREATE_ESCROW_DISCRIMINATOR,
  findEscrowPda,
  findRegisterSessionKeySessionKeyAccountPda,
  findVaultPda,
} from "@faremeter/flex-solana";
import { buildSessionOpenInstructions } from "./open";

const FACILITATOR = address("9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM");
const SESSION_KEY = address("DFo9vd1eiRFGQuCkReqvZvRPJVwwYu8NwCiaa9tB5pWZ");
const MINT = address("EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v");
const SOURCE = address("3QFU3r76XiQVdqkaX5K6FWkDyiBKN7EK3UjRSWxMXHt3");

await t.test(
  "buildSessionOpenInstructions returns three instructions targeting the expected PDAs",
  async (t) => {
    const owner = await generateKeyPairSigner();

    const result = await buildSessionOpenInstructions({
      owner,
      facilitator: FACILITATOR,
      sessionKey: SESSION_KEY,
      mint: MINT,
      source: SOURCE,
      index: 0n,
      depositAmount: 1_000_000n,
      refundTimeoutSlots: 150n,
      deadmanTimeoutSlots: 1000n,
      maxSessionKeys: 4,
      sessionKeyExpiresAtSlot: 2_000_000n,
      sessionKeyGracePeriodSlots: 150n,
    });

    t.equal(result.instructions.length, 3);

    const [expectedEscrow] = await findEscrowPda({
      owner: owner.address,
      index: 0n,
    });
    t.equal(result.escrow, expectedEscrow);

    const [expectedVault] = await findVaultPda({
      escrow: expectedEscrow,
      mint: MINT,
    });
    t.equal(result.vault, expectedVault);

    const [expectedSessionKeyAccount] =
      await findRegisterSessionKeySessionKeyAccountPda({
        escrow: expectedEscrow,
        sessionKey: SESSION_KEY,
      });
    t.equal(result.sessionKeyAccount, expectedSessionKeyAccount);

    for (const ix of result.instructions) {
      t.equal(ix.programAddress, FLEX_PROGRAM_ADDRESS);
    }
    t.end();
  },
);

await t.test(
  "buildSessionOpenInstructions encodes the create_escrow discriminator",
  async (t) => {
    const owner = await generateKeyPairSigner();
    const { instructions } = await buildSessionOpenInstructions({
      owner,
      facilitator: FACILITATOR,
      sessionKey: SESSION_KEY,
      mint: MINT,
      source: SOURCE,
      index: 7n,
      depositAmount: 1_000_000n,
      refundTimeoutSlots: 150n,
      deadmanTimeoutSlots: 1000n,
      maxSessionKeys: 4,
      sessionKeyExpiresAtSlot: 2_000_000n,
      sessionKeyGracePeriodSlots: 150n,
    });

    const createEscrowIx = instructions[0];
    t.ok(createEscrowIx.data);
    const actual = (createEscrowIx.data ?? new Uint8Array()).slice(0, 8);
    t.matchOnly(Array.from(actual), Array.from(CREATE_ESCROW_DISCRIMINATOR));
    t.end();
  },
);

await t.test("create_escrow owner is a writable signer", async (t) => {
  const owner = await generateKeyPairSigner();
  const { instructions } = await buildSessionOpenInstructions({
    owner,
    facilitator: FACILITATOR,
    sessionKey: SESSION_KEY,
    mint: MINT,
    source: SOURCE,
    index: 0n,
    depositAmount: 1n,
    refundTimeoutSlots: 150n,
    deadmanTimeoutSlots: 1000n,
    maxSessionKeys: 1,
    sessionKeyExpiresAtSlot: 2n,
    sessionKeyGracePeriodSlots: 1n,
  });

  const createEscrowIx = instructions[0];
  const firstAccount = createEscrowIx.accounts?.[0];
  t.ok(firstAccount);
  t.equal(firstAccount?.address, owner.address);
  t.equal(firstAccount?.role, AccountRole.WRITABLE_SIGNER);
  t.end();
});
