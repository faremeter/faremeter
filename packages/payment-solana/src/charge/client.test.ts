#!/usr/bin/env pnpm tsx

import t from "tap";
import { MEMO_PROGRAM_ADDRESS } from "@solana-program/memo";
import {
  ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  TOKEN_PROGRAM_ADDRESS,
} from "@solana-program/token";
import {
  decompileTransactionMessage,
  generateKeyPairSigner,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  type Rpc,
  type SolanaRpcApi,
} from "@solana/kit";
import {
  getTransactionDecoder,
  partiallySignTransaction,
} from "@solana/transactions";

import { isValidationError } from "@faremeter/types";
import {
  canonicalizeSortedJSON,
  encodeBase64URL,
  formatMPPDateTime,
  type mppChallengeParams,
} from "@faremeter/types/mpp";

import {
  createMPPSolanaChargeClient,
  createMPPSolanaNativeChargeClient,
} from "./client";
import { chargeCredentialPayload, type mppChargeRequest } from "./common";
import {
  verifyChargeTransaction,
  verifyNativeChargeTransaction,
} from "./verify";
import type { CompilableTransactionMessage } from "../common";
import type { Wallet } from "../exact/client";

const FAKE_BLOCKHASH = "EETubP46DHLkT9hAFKy4x2BoFUqUFvKjiiNVY3CaYRi3";
const OVERSIZED_MEMO = "x".repeat(567);

async function createWallet(
  onSign?: () => void,
  network = "mainnet-beta",
): Promise<Wallet> {
  const signer = await generateKeyPairSigner();
  return {
    network,
    publicKey: signer.address,
    partiallySignTransaction: (tx) => {
      onSign?.();
      return partiallySignTransaction([signer.keyPair], tx);
    },
  };
}

function makeChallenge(request: mppChargeRequest): mppChallengeParams {
  return {
    id: "challenge-id",
    realm: "test",
    method: "solana",
    intent: "charge",
    request: encodeBase64URL(canonicalizeSortedJSON(request)),
    expires: formatMPPDateTime(new Date("2100-01-01T00:00:00Z")),
  };
}

function decodeTransactionPayload(
  transaction: string,
): CompilableTransactionMessage {
  const txBytes = getBase64Encoder().encode(transaction);
  const decodedTx = getTransactionDecoder().decode(txBytes);
  const compiledMessage = getCompiledTransactionMessageDecoder().decode(
    decodedTx.messageBytes,
  );
  return decompileTransactionMessage(compiledMessage);
}

function getTransactionPayload(payload: unknown) {
  const validatedPayload = chargeCredentialPayload(payload);
  if (isValidationError(validatedPayload)) {
    throw new Error(validatedPayload.summary);
  }
  if (validatedPayload.type !== "transaction") {
    throw new Error("expected transaction payload");
  }
  return validatedPayload.transaction;
}

function countMemoInstructions(
  transactionMessage: CompilableTransactionMessage,
) {
  return transactionMessage.instructions.filter(
    (instruction) => instruction.programAddress === MEMO_PROGRAM_ADDRESS,
  ).length;
}

function countATAInstructions(
  transactionMessage: CompilableTransactionMessage,
) {
  return transactionMessage.instructions.filter(
    (instruction) =>
      instruction.programAddress === ASSOCIATED_TOKEN_PROGRAM_ADDRESS,
  ).length;
}

function createMintAccountBase64(decimals: number) {
  const data = new Uint8Array(82);
  data[44] = decimals;
  data[45] = 1;
  return Buffer.from(data).toString("base64");
}

function createFakeRpc(): Rpc<SolanaRpcApi> {
  return {
    getAccountInfo: () => ({
      send: async () => ({
        value: {
          data: [createMintAccountBase64(6), "base64"],
          executable: false,
          lamports: 1_000_000n,
          owner: TOKEN_PROGRAM_ADDRESS,
          space: 82n,
        },
      }),
    }),
  } as unknown as Rpc<SolanaRpcApi>;
}

await t.test(
  "createMPPSolanaChargeClient includes challenge memo",
  async (t) => {
    const wallet = await createWallet();
    const receiver = await generateKeyPairSigner();
    const mint = await generateKeyPairSigner();
    const request: mppChargeRequest = {
      amount: "1000000",
      currency: mint.address,
      recipient: receiver.address,
      externalId: "client-token-memo",
      methodDetails: {
        decimals: 6,
        recentBlockhash: FAKE_BLOCKHASH,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      },
    };

    const handler = createMPPSolanaChargeClient({
      wallet,
      mint: mint.address,
    });
    const execer = await handler(makeChallenge(request));
    if (!execer) {
      throw new Error("expected client to handle token charge challenge");
    }

    const credential = await execer.exec();
    const transactionMessage = decodeTransactionPayload(
      getTransactionPayload(credential.payload),
    );

    const result = await verifyChargeTransaction({
      transactionMessage,
      request,
      feePayerAddress: "",
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, { payer: wallet.publicKey });
    t.end();
  },
);

await t.test("createMPPSolanaChargeClient includes splits", async (t) => {
  const wallet = await createWallet();
  const receiver = await generateKeyPairSigner();
  const splitReceiver = await generateKeyPairSigner();
  const mint = await generateKeyPairSigner();
  const request: mppChargeRequest = {
    amount: "1000000",
    currency: mint.address,
    recipient: receiver.address,
    externalId: "client-token-split-memo",
    methodDetails: {
      decimals: 6,
      recentBlockhash: FAKE_BLOCKHASH,
      splits: [
        {
          amount: "250000",
          memo: "client-token-split",
          recipient: splitReceiver.address,
        },
      ],
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    },
  };

  const handler = createMPPSolanaChargeClient({
    wallet,
    mint: mint.address,
  });
  const execer = await handler(makeChallenge(request));
  if (!execer) {
    throw new Error("expected client to handle token charge challenge");
  }

  const credential = await execer.exec();
  const transactionMessage = decodeTransactionPayload(
    getTransactionPayload(credential.payload),
  );

  const result = await verifyChargeTransaction({
    transactionMessage,
    request,
    feePayerAddress: "",
    tokenProgram: TOKEN_PROGRAM_ADDRESS,
  });

  t.matchOnly(result, { payer: wallet.publicKey });
  t.equal(countATAInstructions(transactionMessage), 1);
  t.end();
});

await t.test(
  "createMPPSolanaChargeClient includes challenge memo with fee payer",
  async (t) => {
    const wallet = await createWallet();
    const receiver = await generateKeyPairSigner();
    const feePayer = await generateKeyPairSigner();
    const mint = await generateKeyPairSigner();
    const request: mppChargeRequest = {
      amount: "1000000",
      currency: mint.address,
      recipient: receiver.address,
      externalId: "client-token-fee-payer-memo",
      methodDetails: {
        decimals: 6,
        feePayer: true,
        feePayerKey: feePayer.address,
        recentBlockhash: FAKE_BLOCKHASH,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      },
    };

    const handler = createMPPSolanaChargeClient({
      wallet,
      mint: mint.address,
    });
    const execer = await handler(makeChallenge(request));
    if (!execer) {
      throw new Error("expected client to handle token charge challenge");
    }

    const credential = await execer.exec();
    const transactionMessage = decodeTransactionPayload(
      getTransactionPayload(credential.payload),
    );

    const result = await verifyChargeTransaction({
      transactionMessage,
      request,
      feePayerAddress: feePayer.address,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, { payer: wallet.publicKey });
    t.end();
  },
);

await t.test(
  "createMPPSolanaChargeClient looks up tokenProgram when omitted",
  async (t) => {
    const wallet = await createWallet();
    const receiver = await generateKeyPairSigner();
    const mint = await generateKeyPairSigner();
    const request: mppChargeRequest = {
      amount: "1000000",
      currency: mint.address,
      recipient: receiver.address,
      methodDetails: {
        decimals: 6,
        recentBlockhash: FAKE_BLOCKHASH,
      },
    };

    const handler = createMPPSolanaChargeClient({
      wallet,
      mint: mint.address,
      rpc: createFakeRpc(),
    });
    const execer = await handler(makeChallenge(request));
    if (!execer) {
      throw new Error("expected client to handle token charge challenge");
    }

    const credential = await execer.exec();
    const transactionMessage = decodeTransactionPayload(
      getTransactionPayload(credential.payload),
    );

    const result = await verifyChargeTransaction({
      transactionMessage,
      request,
      feePayerAddress: "",
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    });

    t.matchOnly(result, { payer: wallet.publicKey });
    t.end();
  },
);

await t.test(
  "createMPPSolanaChargeClient rejects a mismatched token mint",
  async (t) => {
    const wallet = await createWallet();
    const receiver = await generateKeyPairSigner();
    const configuredMint = await generateKeyPairSigner();
    const requestedMint = await generateKeyPairSigner();
    const request: mppChargeRequest = {
      amount: "1000000",
      currency: requestedMint.address,
      recipient: receiver.address,
      methodDetails: {
        decimals: 6,
        recentBlockhash: FAKE_BLOCKHASH,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      },
    };

    const handler = createMPPSolanaChargeClient({
      wallet,
      mint: configuredMint.address,
    });

    t.equal(await handler(makeChallenge(request)), null);
    t.end();
  },
);

await t.test(
  "createMPPSolanaChargeClient rejects unexpected charge fields",
  async (t) => {
    const wallet = await createWallet();
    const receiver = await generateKeyPairSigner();
    const wrongReceiver = await generateKeyPairSigner();
    const splitReceiver = await generateKeyPairSigner();
    const wrongSplitReceiver = await generateKeyPairSigner();
    const feePayer = await generateKeyPairSigner();
    const wrongFeePayer = await generateKeyPairSigner();
    const mint = await generateKeyPairSigner();
    const request: mppChargeRequest = {
      amount: "1000000",
      currency: mint.address,
      recipient: receiver.address,
      methodDetails: {
        decimals: 6,
        feePayer: true,
        feePayerKey: feePayer.address,
        recentBlockhash: FAKE_BLOCKHASH,
        splits: [
          {
            amount: "250000",
            memo: "client-token-expected-split",
            recipient: splitReceiver.address,
          },
        ],
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      },
    };

    const handler = createMPPSolanaChargeClient({
      wallet,
      mint: mint.address,
      expected: {
        amount: request.amount,
        feePayerKey: feePayer.address,
        recipient: receiver.address,
        splits: [
          {
            amount: "250000",
            memo: "client-token-expected-split",
            recipient: splitReceiver.address,
          },
        ],
      },
    });

    t.ok(await handler(makeChallenge(request)));
    t.equal(
      await handler(makeChallenge({ ...request, amount: "1000001" })),
      null,
    );
    t.equal(
      await handler(
        makeChallenge({ ...request, recipient: wrongReceiver.address }),
      ),
      null,
    );
    t.equal(
      await handler(
        makeChallenge({
          ...request,
          methodDetails: {
            ...request.methodDetails,
            feePayerKey: wrongFeePayer.address,
          },
        }),
      ),
      null,
    );
    t.equal(
      await handler(
        makeChallenge({
          ...request,
          methodDetails: {
            ...request.methodDetails,
            splits: [
              {
                amount: "250000",
                memo: "client-token-expected-split",
                recipient: wrongSplitReceiver.address,
              },
            ],
          },
        }),
      ),
      null,
    );
    t.end();
  },
);

await t.test(
  "createMPPSolanaNativeChargeClient includes challenge memo",
  async (t) => {
    const wallet = await createWallet();
    const receiver = await generateKeyPairSigner();
    const request: mppChargeRequest = {
      amount: "1000000",
      currency: "sol",
      recipient: receiver.address,
      externalId: "client-native-memo",
      methodDetails: {
        recentBlockhash: FAKE_BLOCKHASH,
      },
    };

    const handler = createMPPSolanaNativeChargeClient({ wallet });
    const execer = await handler(makeChallenge(request));
    if (!execer) {
      throw new Error("expected client to handle native charge challenge");
    }

    const credential = await execer.exec();
    const transactionMessage = decodeTransactionPayload(
      getTransactionPayload(credential.payload),
    );

    const result = await verifyNativeChargeTransaction({
      transactionMessage,
      request,
      feePayerAddress: "",
    });

    t.matchOnly(result, { payer: wallet.publicKey });
    t.end();
  },
);

await t.test(
  "createMPPSolanaNativeChargeClient rejects unexpected charge fields",
  async (t) => {
    const wallet = await createWallet();
    const receiver = await generateKeyPairSigner();
    const splitReceiver = await generateKeyPairSigner();
    const feePayer = await generateKeyPairSigner();
    const request: mppChargeRequest = {
      amount: "1000000",
      currency: "sol",
      recipient: receiver.address,
      methodDetails: {
        recentBlockhash: FAKE_BLOCKHASH,
      },
    };

    const handler = createMPPSolanaNativeChargeClient({
      wallet,
      expected: {
        amount: request.amount,
        feePayerKey: null,
        recipient: receiver.address,
        splits: [],
      },
    });

    t.ok(await handler(makeChallenge(request)));
    t.equal(
      await handler(
        makeChallenge({
          ...request,
          methodDetails: {
            ...request.methodDetails,
            feePayer: true,
            feePayerKey: feePayer.address,
          },
        }),
      ),
      null,
    );
    t.equal(
      await handler(
        makeChallenge({
          ...request,
          methodDetails: {
            ...request.methodDetails,
            splits: [
              {
                amount: "250000",
                recipient: splitReceiver.address,
              },
            ],
          },
        }),
      ),
      null,
    );
    t.end();
  },
);

await t.test(
  "createMPPSolanaNativeChargeClient rejects network mismatch",
  async (t) => {
    const wallet = await createWallet(undefined, "devnet");
    const receiver = await generateKeyPairSigner();
    const request: mppChargeRequest = {
      amount: "1000000",
      currency: "sol",
      recipient: receiver.address,
      methodDetails: {
        network: "mainnet",
        recentBlockhash: FAKE_BLOCKHASH,
      },
    };

    const handler = createMPPSolanaNativeChargeClient({ wallet });

    t.equal(await handler(makeChallenge(request)), null);
    t.end();
  },
);

await t.test("createMPPSolanaNativeChargeClient includes splits", async (t) => {
  const wallet = await createWallet();
  const receiver = await generateKeyPairSigner();
  const splitReceiver = await generateKeyPairSigner();
  const request: mppChargeRequest = {
    amount: "1000000",
    currency: "sol",
    recipient: receiver.address,
    externalId: "client-native-split-memo",
    methodDetails: {
      recentBlockhash: FAKE_BLOCKHASH,
      splits: [
        {
          amount: "250000",
          memo: "client-native-split",
          recipient: splitReceiver.address,
        },
      ],
    },
  };

  const handler = createMPPSolanaNativeChargeClient({ wallet });
  const execer = await handler(makeChallenge(request));
  if (!execer) {
    throw new Error("expected client to handle native charge challenge");
  }

  const credential = await execer.exec();
  const transactionMessage = decodeTransactionPayload(
    getTransactionPayload(credential.payload),
  );

  const result = await verifyNativeChargeTransaction({
    transactionMessage,
    request,
    feePayerAddress: "",
  });

  t.matchOnly(result, { payer: wallet.publicKey });
  t.end();
});

await t.test(
  "createMPPSolanaNativeChargeClient includes challenge memo with fee payer",
  async (t) => {
    const wallet = await createWallet();
    const receiver = await generateKeyPairSigner();
    const feePayer = await generateKeyPairSigner();
    const request: mppChargeRequest = {
      amount: "1000000",
      currency: "sol",
      recipient: receiver.address,
      externalId: "client-native-fee-payer-memo",
      methodDetails: {
        feePayer: true,
        feePayerKey: feePayer.address,
        recentBlockhash: FAKE_BLOCKHASH,
      },
    };

    const handler = createMPPSolanaNativeChargeClient({ wallet });
    const execer = await handler(makeChallenge(request));
    if (!execer) {
      throw new Error("expected client to handle native charge challenge");
    }

    const credential = await execer.exec();
    const transactionMessage = decodeTransactionPayload(
      getTransactionPayload(credential.payload),
    );

    const result = await verifyNativeChargeTransaction({
      transactionMessage,
      request,
      feePayerAddress: feePayer.address,
    });

    t.matchOnly(result, { payer: wallet.publicKey });
    t.end();
  },
);

await t.test(
  "token charge can build fee-sponsored challenge without externalId",
  async (t) => {
    let signCount = 0;
    const wallet = await createWallet(() => {
      signCount += 1;
    });
    const receiver = await generateKeyPairSigner();
    const feePayer = await generateKeyPairSigner();
    const mint = await generateKeyPairSigner();
    const request: mppChargeRequest = {
      amount: "1000000",
      currency: mint.address,
      recipient: receiver.address,
      methodDetails: {
        decimals: 6,
        feePayer: true,
        feePayerKey: feePayer.address,
        recentBlockhash: FAKE_BLOCKHASH,
        tokenProgram: TOKEN_PROGRAM_ADDRESS,
      },
    };

    const handler = createMPPSolanaChargeClient({
      wallet,
      mint: mint.address,
    });
    const execer = await handler(makeChallenge(request));
    if (!execer) {
      throw new Error("expected client to handle token charge challenge");
    }

    const credential = await execer.exec();
    const transactionMessage = decodeTransactionPayload(
      getTransactionPayload(credential.payload),
    );

    t.equal(signCount, 1);
    t.equal(countMemoInstructions(transactionMessage), 0);
    t.end();
  },
);

await t.test(
  "native charge can build fee-sponsored challenge without externalId",
  async (t) => {
    let signCount = 0;
    const wallet = await createWallet(() => {
      signCount += 1;
    });
    const receiver = await generateKeyPairSigner();
    const feePayer = await generateKeyPairSigner();
    const request: mppChargeRequest = {
      amount: "1000000",
      currency: "sol",
      recipient: receiver.address,
      methodDetails: {
        feePayer: true,
        feePayerKey: feePayer.address,
        recentBlockhash: FAKE_BLOCKHASH,
      },
    };

    const handler = createMPPSolanaNativeChargeClient({ wallet });
    const execer = await handler(makeChallenge(request));
    if (!execer) {
      throw new Error("expected client to handle native charge challenge");
    }

    const credential = await execer.exec();
    const transactionMessage = decodeTransactionPayload(
      getTransactionPayload(credential.payload),
    );

    t.equal(signCount, 1);
    t.equal(countMemoInstructions(transactionMessage), 0);
    t.end();
  },
);

await t.test("token charge omits empty externalId memo", async (t) => {
  let signCount = 0;
  const wallet = await createWallet(() => {
    signCount += 1;
  });
  const receiver = await generateKeyPairSigner();
  const mint = await generateKeyPairSigner();
  const request: mppChargeRequest = {
    amount: "1000000",
    currency: mint.address,
    recipient: receiver.address,
    externalId: "",
    methodDetails: {
      decimals: 6,
      recentBlockhash: FAKE_BLOCKHASH,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    },
  };

  const handler = createMPPSolanaChargeClient({
    wallet,
    mint: mint.address,
  });
  const execer = await handler(makeChallenge(request));
  if (!execer) {
    throw new Error("expected client to handle token charge challenge");
  }

  const credential = await execer.exec();
  const transactionMessage = decodeTransactionPayload(
    getTransactionPayload(credential.payload),
  );

  t.equal(signCount, 1);
  t.equal(countMemoInstructions(transactionMessage), 0);
  t.end();
});

await t.test("native charge omits empty externalId memo", async (t) => {
  let signCount = 0;
  const wallet = await createWallet(() => {
    signCount += 1;
  });
  const receiver = await generateKeyPairSigner();
  const request: mppChargeRequest = {
    amount: "1000000",
    currency: "sol",
    recipient: receiver.address,
    externalId: "",
    methodDetails: {
      recentBlockhash: FAKE_BLOCKHASH,
    },
  };

  const handler = createMPPSolanaNativeChargeClient({ wallet });
  const execer = await handler(makeChallenge(request));
  if (!execer) {
    throw new Error("expected client to handle native charge challenge");
  }

  const credential = await execer.exec();
  const transactionMessage = decodeTransactionPayload(
    getTransactionPayload(credential.payload),
  );

  t.equal(signCount, 1);
  t.equal(countMemoInstructions(transactionMessage), 0);
  t.end();
});

await t.test("token charge rejects oversized externalId memo", async (t) => {
  const wallet = await createWallet();
  const receiver = await generateKeyPairSigner();
  const mint = await generateKeyPairSigner();
  const request: mppChargeRequest = {
    amount: "1000000",
    currency: mint.address,
    recipient: receiver.address,
    externalId: OVERSIZED_MEMO,
    methodDetails: {
      decimals: 6,
      recentBlockhash: FAKE_BLOCKHASH,
      tokenProgram: TOKEN_PROGRAM_ADDRESS,
    },
  };

  const handler = createMPPSolanaChargeClient({
    wallet,
    mint: mint.address,
  });
  const execer = await handler(makeChallenge(request));
  t.equal(execer, null);
  t.end();
});

await t.test("native charge rejects oversized split memo", async (t) => {
  const wallet = await createWallet();
  const receiver = await generateKeyPairSigner();
  const splitReceiver = await generateKeyPairSigner();
  const request: mppChargeRequest = {
    amount: "1000000",
    currency: "sol",
    recipient: receiver.address,
    externalId: "client-native-memo",
    methodDetails: {
      recentBlockhash: FAKE_BLOCKHASH,
      splits: [
        {
          amount: "250000",
          memo: OVERSIZED_MEMO,
          recipient: splitReceiver.address,
        },
      ],
    },
  };

  const handler = createMPPSolanaNativeChargeClient({ wallet });
  const execer = await handler(makeChallenge(request));
  t.equal(execer, null);
  t.end();
});
