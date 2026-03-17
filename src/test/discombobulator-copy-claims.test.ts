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

describe('discombobulator copy claims guardrail', () => {
  it('does not include banned overclaim phrases in key surfaces', () => {
    const haystack = FILES.map((p) => readFileSync(p, 'utf8').toLowerCase()).join('\n');
    for (const phrase of BANNED) {
      expect(haystack).not.toContain(phrase);
    }
  });
});
