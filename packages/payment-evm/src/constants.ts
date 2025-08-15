// X402 Payment Constants
export const X402_EXACT_SCHEME = "exact";

// Network Constants
export const BASE_SEPOLIA_NETWORK = "base-sepolia";
export const BASE_SEPOLIA_CHAIN_ID = 84532;

// Token Addresses
export const USDC_BASE_SEPOLIA = "0x036cbd53842c5426634e7929541ec2318f3dcf7e";

// EIP-3009 TransferWithAuthorization ABI
export const TRANSFER_WITH_AUTHORIZATION_ABI = [
  {
    name: "transferWithAuthorization",
    type: "function",
    stateMutability: "nonpayable",
    inputs: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
      { name: "v", type: "uint8" },
      { name: "r", type: "bytes32" },
      { name: "s", type: "bytes32" },
    ],
    outputs: [],
  },
  {
    name: "authorizationState",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "authorizer", type: "address" },
      { name: "nonce", type: "bytes32" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
  {
    name: "name",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "version",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
  {
    name: "DOMAIN_SEPARATOR",
    type: "function",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "bytes32" }],
  },
] as const;

// EIP-712 Types for TransferWithAuthorization
export const EIP712_TYPES = {
  TransferWithAuthorization: [
    { name: "from", type: "address" },
    { name: "to", type: "address" },
    { name: "value", type: "uint256" },
    { name: "validAfter", type: "uint256" },
    { name: "validBefore", type: "uint256" },
    { name: "nonce", type: "bytes32" },
  ],
} as const;

// EIP-3009 Authorization structure
export interface EIP3009Authorization {
  from: string;
  to: string;
  value: string;
  validAfter: string;
  validBefore: string;
  nonce: string;
}

// X402 Exact Payment Payload
export interface X402ExactPayload {
  signature: string;
  authorization: EIP3009Authorization;
}

// Arktype schema for X402 Exact Payment Payload validation
// Import and use with: const payloadResult = X402_EXACT_PAYLOAD_SCHEMA(payment.payload);
export const X402_EXACT_PAYLOAD_SCHEMA = {
  signature: "string",
  authorization: {
    from: "string",
    to: "string",
    value: "string",
    validAfter: "string",
    validBefore: "string",
    nonce: "string",
  },
} as const;

// Arktype schema for EIP-712 domain parameters in requirements.extra
export const EIP712_DOMAIN_SCHEMA = {
  name: "string?",
  version: "string?",
  chainId: "number?",
  verifyingContract: "string?",
} as const;
