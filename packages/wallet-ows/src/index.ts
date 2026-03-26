/**
 * @title OWS Wallet Package
 * @sidebarTitle Wallet OWS
 * @description Open Wallet Standard integration for Solana and EVM
 * @packageDocumentation
 */
export { createOWSSolanaWallet } from "./solana";
export { createOWSEvmWallet } from "./evm";
export type { OWSSolanaWallet, OWSEvmWallet, OWSWalletOpts } from "./types";
