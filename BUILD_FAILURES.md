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

## 2026-02-08 - Mainnet verifier upgrade confirmed (trap resolved)

**Context:** Final upgrade simulation against Mainnet `verify_and_attest` for contract `CAU7NET7FXSFBBRMLM6X7CJMVAIHMG7RC4YPCXG6G4YOYG6C3CVGR25M`.

**Result:**
- `UnreachableCodeReached` trap is no longer observed.
- Simulation reaches final pairing-check logic.
- Invalid-input responses with dummy points are expected and confirm execution is now inside verifier logic.

**Operational Note:**
Treat the contract as live for real Groth16 submissions; do not use legacy attest-only fallback paths in frontend verification flow.

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

## 6. Build Context Failures
- **Error:** `cargo build` failing with `could not find Cargo.toml`.
- **Root Cause:** Attempting to run `cargo` from the project root instead of the contract-specific directory (`contracts/tier-verifier`).
- **Resolution:** Always `cd` or set the correct `Cwd` when running contract builds.

## 7. `UnreachableCodeReached` during `verify_and_attest`
- **Error:** `HostError: Error(WasmVm, InvalidAction)` with diagnostic `VM call trapped: UnreachableCodeReached`.
- **Root Cause:** Soroban `g1_mul` for `Bn254G1Affine` traps when the scalar is zero (e.g., Tier 0) because affine coordinates cannot represent the resulting point at infinity.
- **Resolution:** Implemented a zero-scalar guard in `lib.rs` to skip `g1_mul` and subsequent addition if the scalar is zero.
- **Verification Status (2026-02-08):** Resolved on Mainnet for `CAU7NET7FXSFBBRMLM6X7CJMVAIHMG7RC4YPCXG6G4YOYG6C3CVGR25M`; simulation now reaches pairing-check stage without VM trap.

---
### ✅ Final Successful State
- **Contract ID:** `CAU7NET7FXSFBBRMLM6X7CJMVAIHMG7RC4YPCXG6G4YOYG6C3CVGR25M`
- **Status:** Fixed and upgraded with zero-scalar guard.

