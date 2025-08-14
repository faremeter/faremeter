# Faremeter Quickstart

Here's a quick way to get the Faremeter tooling up and running. The following will:

- Setup a test environment using Faremeter infrastructure
- Use `devnet` for Solana transactions and Base Sepolia for EVM transactions
- Use the experimental [@faremeter/x-solana-settlement](https://github.com/faremeter/x-solana-settlement) payment scheme for Solana
- Use EIP-3009 gasless USDC transfers for EVM payments

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

## 2. Generate keypairs/wallets

### For Solana

- Payer
- PayTo
- Admin (responsible for settling the transaction).

```
mkdir keypairs
solana-keygen new --no-bip39-passphrase -o keypairs/payer.json
solana-keygen new --no-bip39-passphrase -o keypairs/payto.json
solana-keygen new --no-bip39-passphrase -o keypairs/admin.json
```

### For EVM

Generate EVM private keys for testing:

```
# Generate a new EVM wallet
(cd scripts && pnpm tsx evm-example/gen-wallet.ts)

# Save the generated private key and address for use in step 4
```

## 3. Fund your wallets

### For Solana

Fund all keypairs with SOL on `devnet`:

- Use `solana airdrop`
- Or visit the [Solana Faucet](https://faucet.solana.com)

### For EVM

Fund your Base Sepolia wallets:

- Get Base Sepolia ETH from [Base Sepolia Faucet](https://www.alchemy.com/faucets/base-sepolia)
- Get test USDC from [Circle Faucet](https://faucet.circle.com/) (select Base Sepolia network)

## 4. Setup the configuration

### Solana Configuration

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

### EVM Configuration

To enable EVM support for Base Sepolia USDC payments:

```
# Add to apps/facilitator/.env
cat >> apps/facilitator/.env <<EOF
EVM_PRIVATE_KEY=0xYOUR_FACILITATOR_PRIVATE_KEY_HERE
EVM_RECEIVING_ADDRESS=0xYOUR_RECEIVING_ADDRESS_HERE
EOF

# Add to scripts/.env
cat >> scripts/.env <<EOF
EVM_PRIVATE_KEY=0xYOUR_CLIENT_PRIVATE_KEY_HERE
EOF
```

NOTE: For EVM payments, you'll need:

- USDC tokens on Base Sepolia in your client wallet for making payments
- ETH on Base Sepolia in your facilitator wallet for paying gas fees
- Both EVM_PRIVATE_KEY and EVM_RECEIVING_ADDRESS are required for the facilitator

## 5. Start the facilitator

In a separate terminal, run:

```
(cd apps/facilitator && pnpm tsx src )
```

## 6. Start the resource server

In a separate terminal, run:

For Solana payments:

```
(cd scripts && pnpm tsx solana-example/server-express.ts)
```

For EVM payments:

```
(cd scripts && pnpm tsx evm-example/server-express.ts)
```

## 7. Run a test client

### Solana Payments

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

### EVM Payments

#### USDC Payment on Base Sepolia

Using EIP-3009 gasless transfers (client signs, facilitator pays gas):

```
(cd scripts && pnpm tsx evm-example/base-sepolia-payment.ts)
```

You can also specify a custom port and endpoint:

```
(cd scripts && pnpm tsx evm-example/base-sepolia-payment.ts 4021 premium/content)
```

NOTE: Your client wallet must be funded with USDC on Base Sepolia for this to work.

### Result

For Solana payments, you should see:

```json
{ "msg": "success" }
```

For EVM payments, you should see:

```json
{
  "temperature": 72,
  "conditions": "sunny",
  "message": "Thanks for your payment!"
}
```

... as the client output. At the same time, the facilitator will log the processing of the payment.

## 8. (Optional) Mint A New SPL Token

If you wish to mint a new token, to experiment with and use as the `ASSET_ADDRESS` above, you can run:

```
(cd scripts && pnpm tsx solana-example/create-token.ts)
```

Then take the address exposed as the `new test token`, and put it in both of the environment files as the asset address.
