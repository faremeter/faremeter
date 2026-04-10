/**
 * Backwards-compatibility helpers for callers still using
 * @solana/web3.js v1 types (PublicKey, Keypair).
 *
 * These use duck-typing so payment-solana never imports v1 at
 * runtime. The v1 package stays out of our dependency tree while
 * callers who still have it can pass v1 objects directly.
 *
 * Every helper logs a one-shot deprecation warning the first time
 * the v1 code-path is taken.
 */
import {
  address,
  createKeyPairSignerFromBytes,
  type Address,
  type KeyPairSigner,
} from "@solana/kit";
import { getLogger } from "@faremeter/logs";

const logger = await getLogger(["faremeter", "payment-solana", "compat"]);

let warnedPublicKey = false;
let warnedKeypair = false;

/** Duck-type for @solana/web3.js v1 PublicKey. */
interface PublicKeyLike {
  toBase58(): string;
}

/** Duck-type for @solana/web3.js v1 Keypair. */
interface KeypairLike {
  secretKey: Uint8Array;
  publicKey: PublicKeyLike;
}

function isPublicKeyLike(v: unknown): v is PublicKeyLike {
  return (
    typeof v === "object" &&
    v !== null &&
    typeof (v as PublicKeyLike).toBase58 === "function"
  );
}

function isKeypairLike(v: unknown): v is KeypairLike {
  return (
    typeof v === "object" &&
    v !== null &&
    (v as KeypairLike).secretKey instanceof Uint8Array &&
    isPublicKeyLike((v as KeypairLike).publicKey)
  );
}

/**
 * Accepts an {@link Address} string or a v1 `PublicKey` and returns
 * a kit `Address`.
 */
export function toAddress(input: Address | PublicKeyLike): Address {
  if (typeof input === "string") {
    return address(input);
  }
  if (isPublicKeyLike(input)) {
    if (!warnedPublicKey) {
      logger.warning(
        "Passing a @solana/web3.js PublicKey is deprecated — " +
          "use a plain address string or @solana/kit address() " +
          "instead. v1 compatibility will be removed in a " +
          "future release.",
      );
      warnedPublicKey = true;
    }
    return address(input.toBase58());
  }
  throw new TypeError("expected an Address string or PublicKey");
}

/**
 * Accepts a kit `KeyPairSigner`, a 64-byte secret key, or a v1
 * `Keypair` and returns a `KeyPairSigner`.
 */
export async function toKeyPairSigner(
  input: KeyPairSigner | Uint8Array | KeypairLike,
): Promise<KeyPairSigner> {
  // Already a KeyPairSigner (has signMessages method)
  if (
    typeof input === "object" &&
    input !== null &&
    "address" in input &&
    "signMessages" in input
  ) {
    return input;
  }

  // Raw secret key bytes
  if (input instanceof Uint8Array) {
    return createKeyPairSignerFromBytes(input);
  }

  // v1 Keypair duck-type
  if (isKeypairLike(input)) {
    if (!warnedKeypair) {
      logger.warning(
        "Passing a @solana/web3.js Keypair is deprecated — " +
          "use a Uint8Array secret key or @solana/kit " +
          "KeyPairSigner instead. v1 compatibility will be " +
          "removed in a future release.",
      );
      warnedKeypair = true;
    }
    return createKeyPairSignerFromBytes(input.secretKey);
  }

  throw new TypeError("expected a Uint8Array, KeyPairSigner, or Keypair");
}
