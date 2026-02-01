import * as minimal from "@stellar/stellar-sdk/minimal";
const { contract } = minimal;

console.log("scValToNative in minimal:", "scValToNative" in minimal);
console.log("scValToNative in contract:", "scValToNative" in contract);
console.log("Minimal keys:", Object.keys(minimal));
