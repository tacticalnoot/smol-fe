# Build Failure Log

## 2026-02-08 - Duplicate identifier in Svelte state

**Error:**
```
[vite-plugin-svelte] src/components/labs/the-farm/TheFarmCore.svelte (46:8): Identifier 'txHash' has already been declared
```

**Cause:**
`multi_replace` tool was used to add state variables, but the target range didn't include the existing `txHash` declaration, causing it to be duplicated in the replacement.

**Fix:**
Removed the duplicate declaration.

**Prevention:**
When using `multi_replace` or `replace_file_content` to add state/variables, ALWAYS check the surrounding lines for existing declarations to avoid duplicates. Use `view_file` to confirm the context before applying the edit.

## 2026-02-08 - Markup inside script tag

**Error:**
Invalid Svelte component structure (markup inside `<script>`).

**Cause:**
`multi_replace` targeted `</script>` and replaced it with `markup... </script>`, effectively placing the markup inside the script block.

**Fix:**
Moved the markup to be outside the `<script>` tag.

**Prevention:**
When appending content to the end of a block, be precise about whether it goes *before* or *after* the closing tag.

## 2026-02-08 - Turnstile Integration Reverted

**Issue:**
User reported "Domain Mismatch" (Error 110200) when using Turnstile on `smol-fe` pages.

**Cause:**
Turnstile widget likely requires strict domain allowlisting (e.g. `smol-fe-7jl.pages.dev` vs `localhost`).

**Action:**
Reverted Turnstile integration from `TheFarmCore.svelte` and `zkProof.ts`. Restored the original direct-to-relayer path (with retry). The `turnstileToken` logic has been removed to keep the code clean.

**Status:**
- `TheFarmCore.svelte`: Clean (no Turnstile markup/state).
- `zkProof.ts`: Clean (legacy signatures restored).
- `task.md`: Feature marked as reverted.

## 2026-02-08 - Process Failure: Did not push after fixing issue

**Issue:**
Fixed a critical build error (`TheFarmCore` duplicate identifier) but failed to push the fix to `main` immediately.

**Consequence:**
Delayed resolution for the user and caused confusion about why the build was still failing or if the fix was deployed. The remote environment remained broken while the local environment was fixed.

**Prevention:**
**ALWAYS PUSH IMMEDIATELY** after fixing a critical build error. Do not wait for further unrelated changes (like documentation or optional features) if the build is currently broken. Validating the fix involves ensuring it reaches the deployment pipeline.

- task.md: Feature marked as reverted.

## 2026-02-08 - Runtime: OZ Relayer Timeout & Pool Capacity

**Issue:**
User experiences repeated `503 Service Unavailable` and `500 Internal Server Error` from OpenZeppelin Relayer.
Specific errors:
- `Queue error: timed out`
- `POOL_CAPACITY` ("Too many transactions queued")

**Cause:**
The shared OpenZeppelin Relayer is overwhelmed or experiencing high latency. The `retry` logic is catching it, but the relayer remains unavailable for extended periods (5+ retries failed).

**Status:**
Turnstile failover (to Kale) was the intended fix but was reverted. Currently relying on `withRetry` logic. Need to consider more aggressive backoff or alternative redundancy if OZ remains unstable.

## 2026-02-08 - Runtime: Transaction Failed (Missing Receipt)

**Issue:**
After successful relayer submission (`DIRECT mode SUCCESS`), the UI shows `Verification error: Error: Transaction failed`.

**Cause:**
The relayer is returning a success response (HTTP 200), but `TheFarmCore` or `zkProof` fails to extract the transaction hash from the response object. It expects `result.hash` or `result.transactionHash`. If the relayer returns a different format (e.g. `transactionId` or valid JSON without a hash field), the app assumes failure.

**Fix:**
Update `zkProof.ts` to inspect the relayer response more thoroughly and support multiple hash property names (`hash`, `txHash`, `transactionHash`, `id`). Add debug logging to capture the actual response structure.

## 2026-02-08 - Process Failure: Documentation not synced to git

**Issue:**
`build_failures.md` logs were maintained as local agent artifacts but not pushed to the repository, leading to confusion about what was documented/shared.

**Cause:**
Agent treated the log as a temporary session artifact (`.gemini/antigravity/brain/...`) rather than a repo file.

**Fix:**
Moved `BUILD_FAILURES.md` to the repository root and pushed to `main`.

**Prevention:**
Critical project documentation (like error logs) should live in the repository to ensure visibility and history tracking.
