/**
 * Program IDL in camelCase format in order to be used in JS/TS.
 *
 * Note that this is only a type helper and is not the actual IDL. The original
 * IDL can be found at `target/idl/payment_program.json`.
 */
export type PaymentProgram = {
  address: "DtNVgFBkqb3SSfAY6GH1HtouVcaSCaerHrE3ootDtKQV";
  metadata: {
    name: "paymentProgram";
    version: "0.1.0";
    spec: "0.1.0";
    description: "Created with Anchor";
  };
  instructions: [
    {
      name: "createPayment";
      discriminator: [28, 81, 85, 253, 7, 223, 154, 42];
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
  ];
  types: [
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
            name: "bump";
            type: "u8";
          },
        ];
      };
    },
  ];
};
