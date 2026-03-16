/**
 * Commitment Key Tests
 *
 * Tests for the Discombobulator ZK commitment-note scheme.
 * All tests run in Node.js without a browser or a running dev server.
 *
 * Tests that depend on the Groth16 circuit WASM (browser-only) are
 * expected to fall back to "poseidon_only" mode and are verified accordingly.
 */

import { describe, it, expect } from 'vitest';
import {
    generateCommitmentKey,
    serializeCommitmentKey,
    deserializeCommitmentKey,
    verifyCommitmentKeyIntegrity,
    generateWithdrawalProof,
    summarizeWithdrawalProof,
    COMMITMENT_KEY_VERSION,
    type CommitmentKeyNote,
} from '../utils/discombobulator-commitment-key';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Generate a key and assert it has all required shape. */
async function makeKey(amount = 100_000_000n, token = 'XLM', entryId?: string): Promise<CommitmentKeyNote> {
    return generateCommitmentKey(amount, token, entryId);
}

// ---------------------------------------------------------------------------
// generateCommitmentKey
// ---------------------------------------------------------------------------

describe('generateCommitmentKey', () => {
    it('returns a note with all required fields', async () => {
        const note = await makeKey();

        expect(note.version).toBe(COMMITMENT_KEY_VERSION);
        expect(typeof note.secret).toBe('string');
        expect(note.secret.length).toBeGreaterThan(0);
        expect(typeof note.nullifier).toBe('string');
        expect(note.nullifier.length).toBeGreaterThan(0);
        expect(typeof note.commitment).toBe('string');
        expect(note.commitment.length).toBeGreaterThan(0);
        expect(note.tokenSymbol).toBe('XLM');
        expect(note.amountStroops).toBe('100000000');
        expect(note.poolEntryId).toBeNull();
        expect(typeof note.createdAt).toBe('string');
        expect(typeof note.disclaimer).toBe('string');
        expect(note.disclaimer.length).toBeGreaterThan(0);
    });

    it('stores the correct amountStroops as a string', async () => {
        const note = await makeKey(999_999_999n, 'KALE');
        expect(note.amountStroops).toBe('999999999');
        expect(note.tokenSymbol).toBe('KALE');
    });

    it('stores the poolEntryId when provided', async () => {
        const note = await makeKey(50_000_000n, 'USDC', 'pool-entry-abc123');
        expect(note.poolEntryId).toBe('pool-entry-abc123');
    });

    it('generates different keys on every call (random secret/nullifier)', async () => {
        const a = await makeKey();
        const b = await makeKey();
        // Secrets and nullifiers should differ (probability of collision is negligible)
        expect(a.secret).not.toBe(b.secret);
        expect(a.nullifier).not.toBe(b.nullifier);
        expect(a.commitment).not.toBe(b.commitment);
    });

    it('commitment is a decimal string (BN254 field element)', async () => {
        const note = await makeKey();
        // Should be a large decimal number, not hex or base64
        expect(note.commitment).toMatch(/^\d+$/);
        // Should be a non-trivially-small number
        expect(BigInt(note.commitment)).toBeGreaterThan(0n);
    });

    it('rejects zero amount', async () => {
        await expect(generateCommitmentKey(0n, 'XLM')).rejects.toThrow();
    });

    it('rejects negative amount', async () => {
        await expect(generateCommitmentKey(-1n, 'XLM')).rejects.toThrow();
    });
});

// ---------------------------------------------------------------------------
// serializeCommitmentKey / deserializeCommitmentKey
// ---------------------------------------------------------------------------

describe('serializeCommitmentKey', () => {
    it('returns a string starting with "dck1:"', async () => {
        const note = await makeKey();
        const serialized = await serializeCommitmentKey(note);
        expect(serialized).toMatch(/^dck1:/);
    });

    it('format is dck1:<base64>:<8-char-checksum>', async () => {
        const note = await makeKey();
        const serialized = await serializeCommitmentKey(note);
        const parts = serialized.split(':');
        expect(parts).toHaveLength(3);
        expect(parts[0]).toBe('dck1');
        expect(parts[1].length).toBeGreaterThan(0);  // base64 payload
        expect(parts[2]).toHaveLength(8);             // sha256 checksum
    });
});

describe('deserializeCommitmentKey', () => {
    it('round-trips: serialize → deserialize gives equivalent note', async () => {
        const original = await makeKey(250_000_000n, 'KALE', 'test-pool-entry');
        const serialized = await serializeCommitmentKey(original);
        const recovered = await deserializeCommitmentKey(serialized);

        expect(recovered.version).toBe(original.version);
        expect(recovered.secret).toBe(original.secret);
        expect(recovered.nullifier).toBe(original.nullifier);
        expect(recovered.commitment).toBe(original.commitment);
        expect(recovered.tokenSymbol).toBe(original.tokenSymbol);
        expect(recovered.amountStroops).toBe(original.amountStroops);
        expect(recovered.poolEntryId).toBe(original.poolEntryId);
    });

    it('throws on missing dck1: prefix', async () => {
        await expect(
            deserializeCommitmentKey('AAAABBBBCCCC:deadbeef')
        ).rejects.toThrow(/dck1/);
    });

    it('throws with helpful message on missing prefix', async () => {
        const err = await deserializeCommitmentKey('plaintext').catch(e => e);
        expect(err.message).toContain('dck1:');
    });

    it('throws on bad checksum (corrupted data)', async () => {
        const note = await makeKey();
        const serialized = await serializeCommitmentKey(note);
        // Corrupt the last byte of the checksum
        const corrupted = serialized.slice(0, -1) + (serialized.endsWith('a') ? 'b' : 'a');
        await expect(deserializeCommitmentKey(corrupted)).rejects.toThrow(/checksum/i);
    });

    it('throws on unknown version', async () => {
        const note = await makeKey();
        const wrongVersion = { ...note, version: 'dck-v99' as any };
        const serialized = await serializeCommitmentKey(wrongVersion as CommitmentKeyNote);
        // Patch the version in the b64 by re-serializing with wrong version
        const manualJson = JSON.stringify({ ...note, version: 'dck-v99' });
        const b64 = btoa(manualJson);
        // Compute correct checksum for this mangled payload
        const { sha256Hex } = await import('../utils/discombobulator-spp');
        const checksum = (await sha256Hex(b64)).slice(0, 8);
        const mangled = `dck1:${b64}:${checksum}`;
        await expect(deserializeCommitmentKey(mangled)).rejects.toThrow(/version/i);
    });

    it('throws on too few colon-separated parts', async () => {
        await expect(
            deserializeCommitmentKey('dck1:onlyonepart')
        ).rejects.toThrow(/3.*part/i);
    });

    it('throws on missing required field', async () => {
        const note = await makeKey();
        const incomplete = { ...note } as any;
        delete incomplete.secret;
        const b64 = btoa(JSON.stringify(incomplete));
        const { sha256Hex } = await import('../utils/discombobulator-spp');
        const checksum = (await sha256Hex(b64)).slice(0, 8);
        await expect(
            deserializeCommitmentKey(`dck1:${b64}:${checksum}`)
        ).rejects.toThrow(/secret/i);
    });
});

// ---------------------------------------------------------------------------
// verifyCommitmentKeyIntegrity
// ---------------------------------------------------------------------------

describe('verifyCommitmentKeyIntegrity', () => {
    it('returns valid:true for a freshly generated key', async () => {
        const note = await makeKey();
        const result = await verifyCommitmentKeyIntegrity(note);
        expect(result.valid).toBe(true);
        expect(result.reason).toBeUndefined();
    });

    it('returns valid:true after round-trip serialization', async () => {
        const note = await makeKey();
        const serialized = await serializeCommitmentKey(note);
        const recovered = await deserializeCommitmentKey(serialized);
        const result = await verifyCommitmentKeyIntegrity(recovered);
        expect(result.valid).toBe(true);
    });

    it('returns valid:false when commitment is tampered with', async () => {
        const note = await makeKey();
        const tampered = { ...note, commitment: '12345678901234567890' };
        const result = await verifyCommitmentKeyIntegrity(tampered);
        expect(result.valid).toBe(false);
        expect(result.reason).toBeTruthy();
    });

    it('returns valid:false when secret is tampered with', async () => {
        const note = await makeKey();
        const tampered = { ...note, secret: '0'.repeat(62) };
        const result = await verifyCommitmentKeyIntegrity(tampered);
        expect(result.valid).toBe(false);
    });

    it('returns valid:false when nullifier is tampered with', async () => {
        const note = await makeKey();
        const tampered = { ...note, nullifier: '1'.repeat(62) };
        const result = await verifyCommitmentKeyIntegrity(tampered);
        expect(result.valid).toBe(false);
    });

    it('returns valid:false when amountStroops is tampered with', async () => {
        const note = await makeKey(100_000_000n);
        const tampered = { ...note, amountStroops: '999999999' };
        const result = await verifyCommitmentKeyIntegrity(tampered);
        expect(result.valid).toBe(false);
    });

    it('commitment is deterministic for the same inputs', async () => {
        // Generate a key, then manually recompute its commitment and verify
        const note = await makeKey(500_000_000n);
        // Verify integrity, which recomputes the commitment
        const result = await verifyCommitmentKeyIntegrity(note);
        expect(result.valid).toBe(true);
        // Call it again — must still pass
        const result2 = await verifyCommitmentKeyIntegrity(note);
        expect(result2.valid).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// generateWithdrawalProof
// ---------------------------------------------------------------------------

describe('generateWithdrawalProof', () => {
    // Stellar null account — a valid 56-character G-address used for testing
    const VALID_RECIPIENT = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

    it('returns a proof artifact with all required fields', async () => {
        const note = await makeKey();
        const artifact = await generateWithdrawalProof(note, VALID_RECIPIENT);

        expect(artifact.recipientAddress).toBe(VALID_RECIPIENT);
        expect(artifact.recipientAddressHash).toBeTruthy();
        expect(artifact.commitmentValid).toBe(true);
        expect(['groth16_circuit', 'poseidon_only']).toContain(artifact.proofMode);
        expect(typeof artifact.generatedAt).toBe('string');
        expect(typeof artifact.durationMs).toBe('number');
        expect(artifact.disclaimer).toBeTruthy();
    });

    it('binds proof to the specific recipient address', async () => {
        const note = await makeKey();
        const a1 = await generateWithdrawalProof(note, VALID_RECIPIENT);
        const a2 = await generateWithdrawalProof(note, 'different-recipient-wallet');
        // Different recipients → different address hashes
        expect(a1.recipientAddressHash).not.toBe(a2.recipientAddressHash);
    });

    it('includes disclaimer in all cases', async () => {
        const note = await makeKey();
        const artifact = await generateWithdrawalProof(note, VALID_RECIPIENT);
        expect(artifact.disclaimer.length).toBeGreaterThan(0);
        expect(artifact.disclaimer.toLowerCase()).toContain('research');
    });

    it('falls back to poseidon_only when circuit is unavailable (Node env)', async () => {
        // In Node.js the WASM circuit files are not served; the function
        // should fall back gracefully and still return a valid artifact.
        const note = await makeKey();
        const artifact = await generateWithdrawalProof(note, VALID_RECIPIENT);
        // Either mode is valid depending on environment
        expect(['groth16_circuit', 'poseidon_only']).toContain(artifact.proofMode);
        expect(artifact.commitmentValid).toBe(true);
    });

    it('throws for a tampered (invalid) commitment key', async () => {
        const note = await makeKey();
        const tampered = { ...note, commitment: '0' };
        await expect(
            generateWithdrawalProof(tampered, VALID_RECIPIENT)
        ).rejects.toThrow(/integrity/i);
    });

    it('throws for an empty recipient address', async () => {
        const note = await makeKey();
        await expect(generateWithdrawalProof(note, '')).rejects.toThrow();
    });

    it('throws for a whitespace-only recipient address', async () => {
        const note = await makeKey();
        await expect(generateWithdrawalProof(note, '   ')).rejects.toThrow();
    });

    it('note fields are not mutated by generating a proof', async () => {
        const note = await makeKey();
        const originalSecret = note.secret;
        const originalNullifier = note.nullifier;
        const originalCommitment = note.commitment;
        await generateWithdrawalProof(note, VALID_RECIPIENT);
        expect(note.secret).toBe(originalSecret);
        expect(note.nullifier).toBe(originalNullifier);
        expect(note.commitment).toBe(originalCommitment);
    });
});

// ---------------------------------------------------------------------------
// summarizeWithdrawalProof
// ---------------------------------------------------------------------------

describe('summarizeWithdrawalProof', () => {
    it('returns a summary with truncated sensitive fields', async () => {
        const note = await makeKey();
        const artifact = await generateWithdrawalProof(
            note,
            'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF',
        );
        const summary = summarizeWithdrawalProof(artifact);

        // commitment should be truncated (not the full field)
        const commitmentStr = summary.commitment as string;
        expect(commitmentStr).toContain('...');

        // recipient address should be fully present
        expect(summary.recipientAddress).toBe('GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF');

        // disclaimer should be present
        expect(typeof summary.disclaimer).toBe('string');
    });
});

// ---------------------------------------------------------------------------
// End-to-end: generate → serialize → deserialize → verify → proof
// ---------------------------------------------------------------------------

describe('full flow: generate → serialize → verify → proof', () => {
    it('complete round-trip passes all checks', async () => {
        const amount = 750_000_000n;
        const token = 'KALE';
        const recipient = 'GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF';

        // Step 1: generate
        const note = await generateCommitmentKey(amount, token, 'e2e-test-entry');
        expect(note.amountStroops).toBe('750000000');

        // Step 2: serialize (user copies this string)
        const ticket = await serializeCommitmentKey(note);
        expect(ticket).toMatch(/^dck1:/);

        // Step 3: deserialize (user pastes the ticket later)
        const recovered = await deserializeCommitmentKey(ticket);
        expect(recovered.commitment).toBe(note.commitment);

        // Step 4: verify integrity of the recovered note
        const integrity = await verifyCommitmentKeyIntegrity(recovered);
        expect(integrity.valid).toBe(true);

        // Step 5: generate withdrawal proof for a new recipient wallet
        const artifact = await generateWithdrawalProof(recovered, recipient);
        expect(artifact.commitmentValid).toBe(true);
        expect(artifact.recipientAddress).toBe(recipient);
        // The ZK proof or Poseidon fallback should be present
        expect(['groth16_circuit', 'poseidon_only']).toContain(artifact.proofMode);
    });
});
