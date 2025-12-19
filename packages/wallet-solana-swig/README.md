# @faremeter/wallet-solana-swig

This package adapts the [Swig wallet TypeScript SDK](https://github.com/anagrambuild/swig-ts)
so it can be used as a Faremeter Solana wallet plugin. The helper builds
transactions that call the Swig program, signs them with the controlling
authority, and exposes an optional `sendTransaction` helper so you can submit
the resulting `VersionedTransaction` directly.

## Usage

```ts
import { clusterApiUrl, Connection, Keypair, PublicKey } from '@solana/web3.js';
import { fetchSwig } from '@swig-wallet/classic';
import { createPaymentHandler } from '@faremeter/payment-solana/exact';
import { createSwigWallet } from '@faremeter/wallet-solana-swig';

const connection = new Connection(clusterApiUrl('devnet'));
const swigAddress = new PublicKey(process.env.SWIG_ADDRESS!);
const swig = await fetchSwig(connection, swigAddress);

const authority = Keypair.fromSecretKey(/* ... */);
const authorityRole = swig.findRolesByEd25519SignerPk(authority.publicKey)[0];
if (!authorityRole) throw new Error('role not found');

const wallet = await createSwigWallet({
  network: 'devnet',
  connection,
  swig,
  roleId: authorityRole.id,
  authority,
});

const paymentHandler = createPaymentHandler(
  wallet,
  new PublicKey(process.env.MINT!),
  connection,
  {
    token: { allowOwnerOffCurve: true },
    features: { enableSettlementAccounts: true },
  },
);
```

### Options

- `withSubAccount`: set to `true` when the role keeps funds in a sub-account.
- `payer`: overrides the fee payer. Defaults to the authority signer.
- `refetchBeforeSign`: refreshes the Swig account before each transaction
  (enabled by default).
- `includeCurrentSlot`: controls whether the current slot is included in the
  Swig instruction context. Disable if you already enforce slot windows.
- `swigOptions`: forwards additional `SwigOptions` like a custom `signingFn`.
- `sendOptions`: default options used by `sendTransaction`.

`createSwigWallet` returns an object compatible with the Solana payment handler:

- `network`: the Solana cluster (e.g. `devnet`).
- `publicKey`: the Swig wallet address (not the authority).
- `buildTransaction`: wraps the provided payment instructions with the Swig
  program, signs the transaction with the authority, and returns a ready-to-send
  `VersionedTransaction`.
- `sendTransaction`: submits the signed transaction through the provided
  connection using the optional `sendOptions`.
