import test from 'node:test';
import assert from 'node:assert/strict';
import { generateMixtapeAutoPlan } from '../src/lib/mixtapeAuto.mjs';

test('generateMixtapeAutoPlan returns a safe scaffold plan', () => {
  const plan = generateMixtapeAutoPlan({
    theme: 'paid agent mixtape rail',
    style: 'prog pop cyberwave',
    tempo: 144
  });

  assert.equal(plan.tool, 'smol-mixtape-auto');
  assert.equal(plan.mode, 'local-testnet-prototype');
  assert.equal(plan.safety.mainnetEnabled, false);
  assert.equal(plan.safety.livePaymentExecution, false);
  assert.match(plan.prompt, /paid agent mixtape rail/);
  assert.match(plan.prompt, /144 BPM/);
});

test('generateMixtapeAutoPlan clamps unsafe tempo extremes', () => {
  assert.match(generateMixtapeAutoPlan({ tempo: 999 }).prompt, /220 BPM/);
  assert.match(generateMixtapeAutoPlan({ tempo: 1 }).prompt, /60 BPM/);
});
