# Faremeter Quickstart

Here's a quick way to get the Faremeter tooling up and running. The following will:

- Setup a test environment using Faremeter infrastructure
- Use `devnet` for transactions.
- Use the experimental [@faremeter/x-solana-settlement](https://github.com/faremeter/x-solana-settlement) payment scheme.

From inside the `faremeter` git repository, run the following:

## 0. Install tooling

Install developer tooling:

- [Node.js](https://nodejs.org/en/download)
- [Solana CLI](https://solana.com/docs/intro/installation)
- [pnpm](https://pnpm.io/installation)

NOTE: These tools may also be available from your favorite package manager (e.g. [Homebrew](https://brew.sh).

## 1. Setup your environment

```
pnpm install -r
solana config set -u devnet
make
```

## 2. Generate some keypairs, if you don't already have them

- Payer
- PayTo
- Admin (responsible for settling the transaction).

```
mkdir keypairs
solana-keygen new --no-bip39-passphrase -o keypairs/payer.json
solana-keygen new --no-bip39-passphrase -o keypairs/payto.json
solana-keygen new --no-bip39-passphrase -o keypairs/admin.json
```

## 3. Fund all of the keypairs with some SOL on `devnet`.

You can use `solana airdrop` or use your browser to visit the [Solana Faucet](https://faucet.solana.com).

## 4. Setup the configuration

```
cat > apps/facilitator/.env <<EOF
ASSET_ADDRESS=Hxtm6jXVcA9deMFxJRvMkHewhYJHxCpqsLvH9d1bvxBP
ADMIN_KEYPAIR_PATH=../../keypairs/admin.json
EOF

cat > scripts/.env <<EOF
ASSET_ADDRESS=Hxtm6jXVcA9deMFxJRvMkHewhYJHxCpqsLvH9d1bvxBP
PAYER_KEYPAIR_PATH=../keypairs/payer.json
PAYTO_KEYPAIR_PATH=../keypairs/payto.json
EOF
```

NOTE: To use an SPL Token, you'll need to fund the above keypairs with tokens from the `ASSET_ADDRESS` you provide.

## 5. Start the facilitator

In a separate terminal, run:

```
(cd apps/facilitator && pnpm tsx src )
```

## 6. Start the resource server

In a separate terminal, run:

```
(cd scripts && pnpm tsx solana-example/server-express.ts)
```

## 7. Run a test client

### Pay Using

#### Sol Payment Using Local Keypair

In a separate terminal, run:

```
(cd scripts && pnpm tsx solana-example/sol-payment.ts)
```

#### Native Sol Payment Directly via Squads Smart Wallet

You may also run a payment using Squads:

```
(cd scripts && pnpm tsx solana-example/squads-payment.ts)
```

#### Native Sol Payment via Crossmint API

Or pay using the Crossmint wallet:

```
(cd scripts && pnpm tsx solana-example/crossmint-payment.ts)
```

NOTE: To pay using Crossmint, you must have your `CROSSMINT_WALLET` address and `CROSSMINT_API_KEY` in your `dotenv` or environment. Your Crossmint wallet should be a `Smart Wallet` and you should use your server API key.

#### Pay using an SPL Token Using Local Keypair

```
(cd scripts && pnpm tsx solana-example/token-payment.ts)
```

NOTE: Your payer keypair must be funded with tokens using the above provided `ASSET_ADDRESS` for this method to work.

### Result

You should see:

```
{ msg: 'success' }
```

... as the client output. At the same time, the facilitator will log the processing of the payment.

## 8. (Optional) Mint A New SPL Token

If you wish to mint a new token, to experiment with and use as the `ASSET_ADDRESS` above, you can run:

```
(cd scripts && pnpm tsx solana-example/create-token.ts)
```

Then take the address exposed as the `new test token`, and put it in both of the environment files as the asset address.
