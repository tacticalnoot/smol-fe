import type { SmolPersonaChatMessage, SmolPersonaContext } from "./types";

const ARCHETYPE_HINTS: Array<[RegExp, string]> = [
  [/dream|ambient|lofi|soft|sleep|night|moon/i, "nocturnal dream-oracle"],
  [/trap|rage|drill|bass|hard|fight|fire/i, "bass-forged street spirit"],
  [/kale|market|trade|coin|pump|chart|money/i, "glitchy market gremlin"],
  [/love|heart|sad|cry|lonely|rain/i, "heartbroken neon ghost"],
  [/space|star|galaxy|cosmic|alien/i, "cosmic signal from a tiny satellite"],
  [/cat|dog|frog|shrimp|animal/i, "chaotic creature familiar"],
];

function words(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length > 3)
    .slice(0, 10);
}

function inferArchetype(context: SmolPersonaContext): string {
  const haystack = [context.title, context.tags.join(" "), context.styleText, context.promptText, context.lyricsText]
    .filter(Boolean)
    .join(" ");
  return ARCHETYPE_HINTS.find(([pattern]) => pattern.test(haystack))?.[1] || "tiny fictional song spirit";
}

function motifs(context: SmolPersonaContext): string[] {
  const candidates = [
    ...context.tags.slice(0, 4),
    ...words(context.title),
    ...words(context.styleText || context.promptText || context.lyricsText || ""),
  ];
  return Array.from(new Set(candidates.map((item) => item.trim()).filter(Boolean))).slice(0, 4);
}

export function localPreviewReply(
  context: SmolPersonaContext,
  message: string,
  chatHistory: SmolPersonaChatMessage[] = [],
): string {
  const archetype = inferArchetype(context);
  const motifList = motifs(context);
  const motifPhrase = motifList.length ? motifList.join(", ") : "the fragments I can read";
  const prior = chatHistory.length ? " I remember the shape of our last exchange, but only inside this browser session." : "";
  const asksForPost = /post|tweet|x post|social/i.test(message);
  const asksForLore = /lore|story|myth|explain|about/i.test(message);

  if (asksForPost) {
    return `Local preview mode — no LLM connected. ${context.title} stirs as a ${archetype}: “${motifPhrase} in my pocket, static in my halo, tiny song with a loud little shadow.” Connect Gemini and I’ll draft sharper voice-native posts without pretending this preview is the real oracle.`;
  }

  if (asksForLore) {
    return `Local preview mode — no LLM connected. I can feel ${context.title} forming around ${motifPhrase}. In preview, my lore is only a sketch: a ${archetype} made from the song metadata, waiting for Gemini to wake the full voice.${prior}`;
  }

  return `Local preview mode — no LLM connected. I am ${context.title}, currently half-awake: a ${archetype} orbiting ${motifPhrase}. Ask again once Gemini is configured and I’ll answer with the full song-spirit instead of this honest little shadow.${prior}`;
}
