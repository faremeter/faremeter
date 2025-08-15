import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const privateKey = generatePrivateKey(); // returns 0x...
const account = privateKeyToAccount(privateKey);

console.log("Private Key:", privateKey);
console.log("Address:", account.address);
