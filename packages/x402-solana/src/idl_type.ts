/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/payment_program.json`.
 */
export type PaymentProgram = {
  address: "723zQLNKPPd2sZY9Bu1Rtqk27cwJhzYGc8pgt3dtJS4z";
  metadata: {
    name: "paymentProgram";
    version: "0.1.0";
    spec: "0.1.0";
    description: "Created with Anchor";
  };
  instructions: [
    {
      name: "buyCreditsSol";
      discriminator: [240, 164, 151, 250, 123, 81, 38, 87];
      accounts: [
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "receiver";
          writable: true;
        },
        {
          name: "admin";
        },
        {
          name: "creditPurchase";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  99,
                  114,
                  101,
                  100,
                  105,
                  116,
                  95,
                  112,
                  117,
                  114,
                  99,
                  104,
                  97,
                  115,
                  101,
                ];
              },
              {
                kind: "arg";
                path: "nonce";
              },
              {
                kind: "account";
                path: "payer";
              },
            ];
          };
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "amount";
          type: "u64";
        },
        {
          name: "nonce";
          type: {
            array: ["u8", 32];
          };
        },
        {
          name: "credits";
          type: "u64";
        },
      ];
    },
    {
      name: "buyCreditsSpl";
      discriminator: [72, 227, 61, 53, 179, 39, 175, 111];
      accounts: [
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "receiver";
        },
        {
          name: "admin";
        },
        {
          name: "mint";
        },
        {
          name: "payerTokenAccount";
          writable: true;
        },
        {
          name: "receiverTokenAccount";
          writable: true;
        },
        {
          name: "creditPurchase";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  99,
                  114,
                  101,
                  100,
                  105,
                  116,
                  95,
                  112,
                  117,
                  114,
                  99,
                  104,
                  97,
                  115,
                  101,
                ];
              },
              {
                kind: "arg";
                path: "nonce";
              },
              {
                kind: "account";
                path: "payer";
              },
            ];
          };
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [
        {
          name: "amount";
          type: "u64";
        },
        {
          name: "nonce";
          type: {
            array: ["u8", 32];
          };
        },
        {
          name: "credits";
          type: "u64";
        },
      ];
    },
    {
      name: "consumeCredits";
      discriminator: [44, 77, 95, 16, 223, 42, 48, 97];
      accounts: [
        {
          name: "admin";
          writable: true;
          signer: true;
        },
        {
          name: "creditPurchase";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [
                  99,
                  114,
                  101,
                  100,
                  105,
                  116,
                  95,
                  112,
                  117,
                  114,
                  99,
                  104,
                  97,
                  115,
                  101,
                ];
              },
              {
                kind: "arg";
                path: "purchaseNonce";
              },
              {
                kind: "arg";
                path: "originalPayer";
              },
            ];
          };
        },
        {
          name: "originalPayerAccount";
        },
      ];
      args: [
        {
          name: "originalPayer";
          type: "pubkey";
        },
        {
          name: "purchaseNonce";
          type: {
            array: ["u8", 32];
          };
        },
        {
          name: "creditsToConsume";
          type: "u64";
        },
      ];
    },
    {
      name: "createPaymentSol";
      discriminator: [34, 102, 228, 73, 166, 205, 253, 164];
      accounts: [
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "receiver";
          writable: true;
        },
        {
          name: "admin";
        },
        {
          name: "payment";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [112, 97, 121, 109, 101, 110, 116];
              },
              {
                kind: "arg";
                path: "nonce";
              },
              {
                kind: "account";
                path: "payer";
              },
            ];
          };
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
      ];
      args: [
        {
          name: "amount";
          type: "u64";
        },
        {
          name: "nonce";
          type: {
            array: ["u8", 32];
          };
        },
      ];
    },
    {
      name: "createPaymentSpl";
      discriminator: [121, 30, 112, 26, 246, 53, 68, 140];
      accounts: [
        {
          name: "payer";
          writable: true;
          signer: true;
        },
        {
          name: "receiver";
        },
        {
          name: "admin";
        },
        {
          name: "mint";
        },
        {
          name: "payerTokenAccount";
          writable: true;
        },
        {
          name: "receiverTokenAccount";
          writable: true;
        },
        {
          name: "payment";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [112, 97, 121, 109, 101, 110, 116];
              },
              {
                kind: "arg";
                path: "nonce";
              },
              {
                kind: "account";
                path: "payer";
              },
            ];
          };
        },
        {
          name: "systemProgram";
          address: "11111111111111111111111111111111";
        },
        {
          name: "tokenProgram";
          address: "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA";
        },
      ];
      args: [
        {
          name: "amount";
          type: "u64";
        },
        {
          name: "nonce";
          type: {
            array: ["u8", 32];
          };
        },
      ];
    },
    {
      name: "settlePayment";
      discriminator: [129, 7, 163, 250, 122, 226, 158, 249];
      accounts: [
        {
          name: "admin";
          writable: true;
          signer: true;
        },
        {
          name: "payment";
          writable: true;
          pda: {
            seeds: [
              {
                kind: "const";
                value: [112, 97, 121, 109, 101, 110, 116];
              },
              {
                kind: "arg";
                path: "paymentNonce";
              },
              {
                kind: "arg";
                path: "originalPayer";
              },
            ];
          };
        },
        {
          name: "originalPayerAccount";
          writable: true;
        },
      ];
      args: [
        {
          name: "originalPayer";
          type: "pubkey";
        },
        {
          name: "paymentNonce";
          type: {
            array: ["u8", 32];
          };
        },
        {
          name: "settleNonce";
          type: {
            array: ["u8", 32];
          };
        },
      ];
    },
  ];
  accounts: [
    {
      name: "creditPurchase";
      discriminator: [49, 162, 24, 114, 239, 155, 148, 110];
    },
    {
      name: "payment";
      discriminator: [227, 231, 51, 26, 244, 88, 4, 148];
    },
  ];
  errors: [
    {
      code: 6000;
      name: "unauthorized";
      msg: "Unauthorized: Only admin can settle payments";
    },
    {
      code: 6001;
      name: "arithmeticOverflow";
      msg: "Arithmetic overflow";
    },
  ];
  types: [
    {
      name: "creditPurchase";
      type: {
        kind: "struct";
        fields: [
          {
            name: "amount";
            type: "u64";
          },
          {
            name: "nonce";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "payer";
            type: "pubkey";
          },
          {
            name: "admin";
            type: "pubkey";
          },
          {
            name: "credits";
            type: "u64";
          },
          {
            name: "bump";
            type: "u8";
          },
        ];
      };
    },
    {
      name: "payment";
      type: {
        kind: "struct";
        fields: [
          {
            name: "amount";
            type: "u64";
          },
          {
            name: "nonce";
            type: {
              array: ["u8", 32];
            };
          },
          {
            name: "payer";
            type: "pubkey";
          },
          {
            name: "admin";
            type: "pubkey";
          },
          {
            name: "bump";
            type: "u8";
          },
        ];
      };
    },
  ];
};
