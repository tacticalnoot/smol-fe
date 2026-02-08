# 🛠️ Tier Verifier Deployment: Post-Mortem & Failures Log

This document tracks the technical hurdles, errors, and "gotchas" encountered while deploying and initializing the `tier-verifier` contract on Stellar Mainnet.

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
- **Lessons:** Even if an object has keys in order in JS, `nativeToScVal` might not guarantee the output XDR `ScMap` is sorted unless specifically handled.
- **Final Fix:** Manually constructed `xdr.ScVal.scvMap` with a sorted array of `ScMapEntry`.

## 4. WASM Signature Mismatch (`MismatchingParameterLen`)
- **Error:** `VM call failed: Func(MismatchingParameterLen)` for `initialize`.
- **Root Cause:** The `lib.rs` source code defined `initialize(admin, vkey)`, but the compiled WASM being inspected/deployed only showed `initialize(admin)`. This was due to a **stale WASM artifact** in `target/` not reflecting recent source changes.
- **Resolution:** Performed a `cargo clean` and a fresh `cargo build` to ensure the WASM interface matched the Rust source.

## 5. Map Key Type Mismatch (`UnexpectedType`)
- **Error:** `HostError: Error(Value, UnexpectedType)` during `map_unpack_to_linear_memory`.
- **Root Cause:** `nativeToScVal` converts object keys to `scvString` by default. However, Soroban contract types (structs) expect **`scvSymbol`** for field names.
- **Resolution:** Switched to manual `ScMap` construction using `xdr.ScVal.scvSymbol` for keys:
  ```javascript
  new xdr.ScMapEntry({ 
    key: xdr.ScVal.scvSymbol("alpha_g1"), 
    val: xdr.ScVal.scvBytes(...) 
  })
  ```

## 6. Build Context Failures
- **Error:** `cargo build` failing with `could not find Cargo.toml`.
- **Root Cause:** Attempting to run `cargo` from the project root instead of the contract-specific directory (`contracts/tier-verifier`).
- **Resolution:** Always `cd` or set the correct `Cwd` when running contract builds.

---

### ✅ Final Successful State
- **Contract ID:** `CAU7NET7FXSFBBRMLM6X7CJMVAIHMG7RC4YPCXG6G4YOYG6C3CVGR25M`
- **Initialzed with:** Admin Address + Full Groth16 Verification Key.
- **Frontend Sync:** `zkTypes.ts` updated.
