#!/usr/bin/env pnpm tsx

import t from "tap";
import { isValidationError } from "@faremeter/types";
import { generateKeyPairSigner } from "@solana/kit";
import { TOKEN_PROGRAM_ADDRESS } from "@solana-program/token";

import {
  SOLANA_CHARGE_CURRENCY_MAX_LENGTH,
  SOLANA_CHARGE_DESCRIPTION_MAX_LENGTH,
  SOLANA_CHARGE_TRANSACTION_MAX_BYTES,
  SOLANA_MEMO_MAX_BYTES,
  chargeCredentialPayload,
  mppChargeRequest,
} from "./common";
import { TOKEN_2022_PROGRAM_ADDRESS } from "../splToken";

const recipient = await generateKeyPairSigner();
const splitRecipient = await generateKeyPairSigner();
const mint = await generateKeyPairSigner();
const feePayer = await generateKeyPairSigner();

function createNativeRequest() {
  return {
    amount: "1000000",
    currency: "sol",
    recipient: recipient.address,
    methodDetails: {},
  };
}

function createTokenRequest() {
  return {
    amount: "1000000",
    currency: mint.address,
    recipient: recipient.address,
    methodDetails: {
      decimals: 6,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    },
  };
}

await t.test(
  "mppChargeRequest validates positive uint64 amounts",
  async (t) => {
    for (const amount of ["0", "-1", "1.5", "1e3", "01"]) {
      const request = mppChargeRequest({
        ...createNativeRequest(),
        amount,
      });
      t.equal(isValidationError(request), true, amount);
    }

    t.equal(
      isValidationError(
        mppChargeRequest({
          ...createNativeRequest(),
          amount: "18446744073709551615",
        }),
      ),
      false,
    );
    t.equal(
      isValidationError(
        mppChargeRequest({
          ...createNativeRequest(),
          amount: "18446744073709551616",
        }),
      ),
      true,
    );
    t.end();
  },
);

await t.test("mppChargeRequest validates Solana public keys", async (t) => {
  t.equal(
    isValidationError(
      mppChargeRequest({
        ...createNativeRequest(),
        recipient: "not-base58",
      }),
    ),
    true,
  );
  t.equal(
    isValidationError(
      mppChargeRequest({
        ...createTokenRequest(),
        currency: "not-base58",
      }),
    ),
    true,
  );
  t.equal(
    isValidationError(
      mppChargeRequest({
        ...createNativeRequest(),
        methodDetails: {
          feePayer: true,
          feePayerKey: "not-base58",
        },
      }),
    ),
    true,
  );
  t.end();
});

await t.test("mppChargeRequest enforces length limits", async (t) => {
  t.equal(
    isValidationError(
      mppChargeRequest({
        ...createTokenRequest(),
        currency: "x".repeat(SOLANA_CHARGE_CURRENCY_MAX_LENGTH + 1),
      }),
    ),
    true,
  );
  t.equal(
    isValidationError(
      mppChargeRequest({
        ...createNativeRequest(),
        description: "x".repeat(SOLANA_CHARGE_DESCRIPTION_MAX_LENGTH),
      }),
    ),
    false,
  );
  t.equal(
    isValidationError(
      mppChargeRequest({
        ...createNativeRequest(),
        description: "x".repeat(SOLANA_CHARGE_DESCRIPTION_MAX_LENGTH + 1),
      }),
    ),
    true,
  );
  t.equal(
    isValidationError(
      mppChargeRequest({
        ...createNativeRequest(),
        externalId: "x".repeat(SOLANA_MEMO_MAX_BYTES + 1),
      }),
    ),
    true,
  );
  t.equal(
    isValidationError(
      mppChargeRequest({
        ...createNativeRequest(),
        methodDetails: {
          splits: [
            {
              amount: "1",
              memo: "x".repeat(SOLANA_MEMO_MAX_BYTES + 1),
              recipient: splitRecipient.address,
            },
          ],
        },
      }),
    ),
    true,
  );
  t.end();
});

await t.test(
  "mppChargeRequest enforces SPL token method details",
  async (t) => {
    for (const decimals of [-1, 1.5, 10]) {
      const request = mppChargeRequest({
        ...createTokenRequest(),
        methodDetails: {
          decimals,
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        },
      });
      t.equal(isValidationError(request), true, String(decimals));
    }

    t.equal(
      isValidationError(
        mppChargeRequest({
          ...createTokenRequest(),
          methodDetails: {
            tokenProgram: TOKEN_PROGRAM_ADDRESS,
          },
        }),
      ),
      true,
    );
    t.equal(
      isValidationError(
        mppChargeRequest({
          ...createTokenRequest(),
          methodDetails: {
            decimals: 6,
          },
        }),
      ),
      false,
    );
    t.equal(
      isValidationError(
        mppChargeRequest({
          ...createTokenRequest(),
          methodDetails: {
            decimals: 6,
            tokenProgram: feePayer.address,
          },
        }),
      ),
      true,
    );
    t.equal(
      isValidationError(
        mppChargeRequest({
          ...createTokenRequest(),
          methodDetails: {
            decimals: 6,
            tokenProgram: "not-base58",
          },
        }),
      ),
      true,
    );
    t.equal(
      isValidationError(
        mppChargeRequest({
          ...createTokenRequest(),
          methodDetails: {
            decimals: 0,
            tokenProgram: TOKEN_2022_PROGRAM_ADDRESS,
          },
        }),
      ),
      false,
    );
    t.end();
  },
);

await t.test("mppChargeRequest enforces SOL method details", async (t) => {
  t.equal(
    isValidationError(
      mppChargeRequest({
        ...createNativeRequest(),
        methodDetails: {
          decimals: 9,
        },
      }),
    ),
    true,
  );
  t.equal(
    isValidationError(
      mppChargeRequest({
        ...createNativeRequest(),
        methodDetails: {
          tokenProgram: TOKEN_PROGRAM_ADDRESS,
        },
      }),
    ),
    true,
  );
  t.equal(
    isValidationError(
      mppChargeRequest({
        ...createNativeRequest(),
        methodDetails: {
          splits: [
            {
              amount: "1",
              ataCreationRequired: true,
              recipient: splitRecipient.address,
            },
          ],
        },
      }),
    ),
    true,
  );
  t.end();
});

await t.test("mppChargeRequest validates fee payer fields", async (t) => {
  t.equal(
    isValidationError(
      mppChargeRequest({
        ...createNativeRequest(),
        methodDetails: {
          feePayer: true,
        },
      }),
    ),
    true,
  );
  t.equal(
    isValidationError(
      mppChargeRequest({
        ...createNativeRequest(),
        methodDetails: {
          feePayerKey: feePayer.address,
        },
      }),
    ),
    true,
  );
  t.equal(
    isValidationError(
      mppChargeRequest({
        ...createNativeRequest(),
        methodDetails: {
          feePayer: false,
          feePayerKey: feePayer.address,
        },
      }),
    ),
    true,
  );
  t.equal(
    isValidationError(
      mppChargeRequest({
        ...createNativeRequest(),
        methodDetails: {
          feePayer: true,
          feePayerKey: feePayer.address,
        },
      }),
    ),
    false,
  );
  t.end();
});

await t.test(
  "mppChargeRequest validates split recipients and totals",
  async (t) => {
    t.equal(
      isValidationError(
        mppChargeRequest({
          ...createNativeRequest(),
          methodDetails: {
            splits: [
              {
                amount: "1",
                recipient: "not-base58",
              },
            ],
          },
        }),
      ),
      true,
    );
    t.equal(
      isValidationError(
        mppChargeRequest({
          ...createNativeRequest(),
          methodDetails: {
            splits: [
              {
                amount: "1000000",
                recipient: splitRecipient.address,
              },
            ],
          },
        }),
      ),
      true,
    );
    t.equal(
      isValidationError(
        mppChargeRequest({
          ...createNativeRequest(),
          methodDetails: {
            splits: [
              {
                amount: "999999",
                recipient: splitRecipient.address,
              },
            ],
          },
        }),
      ),
      false,
    );
    t.end();
  },
);

await t.test("chargeCredentialPayload validates signatures", async (t) => {
  t.equal(
    isValidationError(
      chargeCredentialPayload({
        type: "signature",
        signature: "1".repeat(64),
      }),
    ),
    false,
  );
  for (const signature of ["not-base58", "", "1".repeat(63), "1".repeat(65)]) {
    t.equal(
      isValidationError(
        chargeCredentialPayload({
          type: "signature",
          signature,
        }),
      ),
      true,
      signature,
    );
  }
  t.end();
});

await t.test("chargeCredentialPayload validates transactions", async (t) => {
  t.equal(
    isValidationError(
      chargeCredentialPayload({
        type: "transaction",
        transaction: Buffer.alloc(SOLANA_CHARGE_TRANSACTION_MAX_BYTES).toString(
          "base64",
        ),
      }),
    ),
    false,
  );
  for (const transaction of [
    "",
    "not-base64",
    Buffer.alloc(SOLANA_CHARGE_TRANSACTION_MAX_BYTES + 1).toString("base64"),
  ]) {
    t.equal(
      isValidationError(
        chargeCredentialPayload({
          type: "transaction",
          transaction,
        }),
      ),
      true,
      transaction.length.toString(),
    );
  }
  t.end();
});
