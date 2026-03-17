import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';

const FILES = [
  'src/components/labs/DiscombobulatorCore.svelte',
  'src/utils/discombobulator-commitment-key.ts',
  'src/utils/discombobulator-private-paths.ts',
  'contracts/commitment-pool/src/lib.rs',
];

const BANNED = [
  'tornado cash style',
  'unlinkable mixer',
  'anonymous withdraw',
  'full privacy pool',
];

// Mandatory warning phrases that MUST appear (Outcome A user-safety requirements).
// See: docs/audits/discombobulator-pr117/UI_COPY_PATCH.md
// See: docs/audits/discombobulator-pr117/MAINNET_READINESS_CHECKLIST.md Gate 8
const REQUIRED_IN_SVELTE = [
  // Bearer risk — "anyone with the ticket can withdraw"
  'bearer',
  // Ticket loss warning
  'losing it means losing',
  // Reduced assurance when poseidon_only mode is active
  'poseidon_only',
  // Not audited disclaimer
  'not audited',
  // Not an anonymity-set guarantee
  'anonymity-set',
  // Research-mode framing
  'research',
];

// Phrases that must appear in the commitment-key utility (module-level truth)
const REQUIRED_IN_COMMITMENT_KEY = [
  'bearer',
  'not audited',
  'no anonymity-set',
  'pre-alpha',
];

// Phrases that confirm honest framing in the contract module
const REQUIRED_IN_CONTRACT = [
  'bearer-note escrow',
  'not an anonymity-set',
];

describe('discombobulator copy claims guardrail', () => {
  it('does not include banned overclaim phrases in key surfaces', () => {
    const haystack = FILES.map((p) => readFileSync(p, 'utf8').toLowerCase()).join('\n');
    for (const phrase of BANNED) {
      expect(haystack, `banned phrase found: "${phrase}"`).not.toContain(phrase);
    }
  });

  it('Svelte UI includes all mandatory Outcome A warning phrases', () => {
    const svelte = readFileSync('src/components/labs/DiscombobulatorCore.svelte', 'utf8').toLowerCase();
    for (const phrase of REQUIRED_IN_SVELTE) {
      expect(svelte, `mandatory warning phrase missing from Svelte: "${phrase}"`).toContain(phrase);
    }
  });

  it('commitment-key utility module includes honest scope language', () => {
    const src = readFileSync('src/utils/discombobulator-commitment-key.ts', 'utf8').toLowerCase();
    for (const phrase of REQUIRED_IN_COMMITMENT_KEY) {
      expect(src, `required phrase missing from commitment-key.ts: "${phrase}"`).toContain(phrase);
    }
  });

  it('contract module has honest bearer-note framing (not mixer framing)', () => {
    const src = readFileSync('contracts/commitment-pool/src/lib.rs', 'utf8').toLowerCase();
    for (const phrase of REQUIRED_IN_CONTRACT) {
      expect(src, `required phrase missing from lib.rs: "${phrase}"`).toContain(phrase);
    }
  });
});
