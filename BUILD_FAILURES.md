# Build Failure Log

## 2026-02-08 - Duplicate identifier in Svelte state

**Error:** `Duplicate identifier 'is_loading'` in `src/components/labs/the-farm/zkProof.ts`.

**Cause:**
Multiple components were initializing the same state variable name during refactoring.

**Resolution:**
Renamed the local state variable to `is_action_loading` to avoid collisions and verified the module structure after editing.

---

## 2026-02-08 - "500 Internal Server Error" from Relayer

**Error:** `500 Internal Server Error` from OpenZeppelin Relayer.
Specific errors:
- `Queue error: timed out`
- `POOL_CAPACITY` ("Too many transactions queued")

**Cause:**
The shared OpenZeppelin relayer pool for Soroban testnet was congested or the account nonces were out of sync during high-frequency testing.

**Resolution:**
Implemented a retry mechanism with exponential backoff and localized the relayer interaction to avoid blocking the UI.

---

# 🛠️ Tier Verifier Deployment: Post-Mortem & Failures Log

This section tracks the technical hurdles encountered while deploying and initializing the `tier-verifier` contract on Stellar Mainnet.

## 1. Upgrade Permissions (Admin Lock)
- **Error:** `Contract already exists` / `Unauthorized` during upgrade.
- **Root Cause:** The existing contract was deployed by a different address/authority. The `tier-verifier-deployer` was not the administrator.
- **Resolution:** Deployed a **new contract instance** instead of attempting to upgrade the legacy one.

## 2. ESM/CommonJS SDK Import Issues
- **Error:** `SyntaxError: Named export 'SorobanRpc' not found` or `TypeError: Cannot read properties of undefined (reading 'Server')`.
- **Root Cause:** `@stellar/stellar-sdk` behaves differently between ESM and CommonJS. Named exports like `SorobanRpc` were not available in the Node.js environment as expected.
- **Resolution:** Used default imports:
  ```javascript
  import pkg from '@stellar/stellar-sdk';
  const { rpc, xdr, ... } = pkg;
  const server = new rpc.Server(URL);
  ```

## 3. ScMap Strict Sorting Requirement
- **Error:** `HostError: Error(Object, InvalidInput)` ... `ScMap was not sorted by key for conversion to host object`.
- **Root Cause:** Soroban requires map keys in XDR to be sorted lexicographically by their bytes.
- **Resolution:** Manually constructed `xdr.ScVal.scvMap` with a sorted array of `ScMapEntry`.

## 4. WASM Signature Mismatch (`MismatchingParameterLen`)
- **Error:** `VM call failed: Func(MismatchingParameterLen)` for `initialize`.
- **Root Cause:** The `lib.rs` source code defined `initialize(admin, vkey)`, but the compiled WASM reflected a previous version.
- **Resolution:** Performed a `cargo clean` and a fresh `cargo build` to ensure the WASM interface matched the Rust source.

## 5. Map Key Type Mismatch (`UnexpectedType`)
- **Error:** `HostError: Error(Value, UnexpectedType)` during `map_unpack_to_linear_memory`.
- **Root Cause:** `nativeToScVal` converts object keys to `scvString`. Soroban structs expect **`scvSymbol`**.
- **Resolution:** Switched to manual `ScMap` construction using `xdr.ScVal.scvSymbol` for keys.

---
### ✅ Final Successful State
- **Contract ID:** `CAU7NET7FXSFBBRMLM6X7CJMVAIHMG7RC4YPCXG6G4YOYG6C3CVGR25M`
- **Initialzed with:** Admin Address + Full Groth16 Verification Key.
