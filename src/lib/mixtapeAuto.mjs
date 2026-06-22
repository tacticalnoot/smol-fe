const DEFAULT_TOOL = 'smol-mixtape-auto';

const clampText = (value, fallback, maxLength = 240) => {
  const text = typeof value === 'string' ? value.trim() : '';
  if (!text) return fallback;
  return text.slice(0, maxLength);
};

const normalizeTempo = (value) => {
  const tempo = Number(value);
  if (!Number.isFinite(tempo)) return 128;
  return Math.max(60, Math.min(220, Math.round(tempo)));
};

export function generateMixtapeAutoPlan(input = {}) {
  const theme = clampText(input.theme, 'agentic midnight mixtape');
  const style = clampText(input.style, 'progressive K-pop cyberwave with Stellar-clean UI energy');
  const audience = clampText(input.audience, 'Smol builders and music-tool obsessives');
  const rail = clampText(input.rail, 'local-first testnet-ready 402 gate');
  const tempo = normalizeTempo(input.tempo);

  const prompt = [
    `[STYLE] ${style}; ${tempo} BPM; hook-forward, high-detail, mobile-first, generator-safe.`,
    `[CONCEPT] ${theme}.`,
    `[AUDIENCE] ${audience}.`,
    `[STRUCTURE] cold open -> mixtape tag -> feature burst -> payoff hook -> clean ending.`,
    `[RAIL] ${rail}; no live payment execution; no secrets; local/testnet only until approved.`
  ].join('\n');

  return {
    tool: DEFAULT_TOOL,
    version: '0.1.0',
    mode: 'local-testnet-prototype',
    status: 'scaffold',
    prompt,
    nextActions: [
      'Wire this generator to the real Mixtape Auto runtime in the local Codex workspace.',
      'Add a 402/testnet gate only after the plain endpoint works.',
      'Add pricing metadata as configuration, not secrets.',
      'Run pnpm test and pnpm build in the runtime environment.'
    ],
    safety: {
      secretsCommitted: false,
      mainnetEnabled: false,
      livePaymentExecution: false,
      requiresApprovalForMoneyMovement: true
    }
  };
}
