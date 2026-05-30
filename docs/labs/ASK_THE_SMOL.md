# Ask the Smol

Ask the Smol is a Labs experiment at `/labs/ask-the-smol` with the slogan:

> Every Smol has a soul. Ask it questions.

It lets a visitor search the available Smol corpus, select any song, and talk to a fictional song-persona built from that Smol's metadata.

## Data sources used

The lab loads Smols through the existing canonical frontend data path:

- `safeFetchSmols()` from `src/services/api/smols.ts`
- live `PUBLIC_API_URL` / `https://api.smol.xyz` when available
- `public/data/GalacticSnapshot.json` via the existing snapshot fallback path when the live API is unavailable or empty

The lab does not hardcode sample songs. It requests the same broad all-Smols list used by discovery surfaces and falls back to the repository snapshot loader.

## Persona normalization

`normalizeSmol()` accepts unknown raw Smol records and defensively extracts:

- id
- title
- creator / artist
- tags
- style, prompt, description, and lyrics text
- image and audio URLs
- source fields used for the Prompt Inspector

The normalizer tries both legacy and newer field names, including `Title`, `Id`, `Tags`, `Minted_By`, `kv_do`, `d1`, `wf`, `lyrics`, and `metadata` shapes. Long lyrics, prompt, and style blocks are capped before being sent to the prompt builder.

## Universal prompt summary

Every song uses the same universal system prompt in `buildSmolPersonaPrompt()`.

The prompt tells the model to behave as the fictional voice, emotional logic, aesthetic intelligence, and lore engine of the supplied Smol. The song context changes per Smol; the steering prompt does not.

The final prompt is composed as:

1. universal Ask the Smol system prompt
2. compact `SMOL CONTEXT` block
3. recent local chat history
4. current user message

The Prompt Inspector in the UI exposes each of those pieces so humans can see exactly how the song-persona is being shaped.

## Gemini / LLM adapter

The server endpoint lives at `src/pages/api/ask-the-smol.ts`.

It follows the existing radio/AI route pattern:

- uses `@google/genai`
- expects the existing `GEMINI_API_KEY` server-side environment variable
- enforces same-origin requests
- applies the shared lightweight rate limiter
- never exposes secrets to the browser

Request shape:

```json
{
  "smolPersonaContext": {},
  "message": "Explain yourself",
  "chatHistory": []
}
```

Response shape:

```json
{
  "ok": true,
  "mode": "llm",
  "reply": "..."
}
```

If Gemini is missing or fails, the endpoint returns a structured error instead of crashing the lab.

## Fallback mode

The Svelte lab component includes a deterministic local preview fallback.

Fallback mode:

- is visibly labeled as `Local preview fallback`
- uses title, tags, style, prompt, lyrics, and chat history hints to sketch a song-spirit response
- does not pretend to be Gemini or a real LLM response
- keeps the UX and Prompt Inspector usable while environment keys are missing or stale

## Safety rules

The universal prompt and UI safety copy state that the persona is fictional and is not:

- the creator
- a real person
- the artist
- financial advice
- legal advice
- medical advice
- political authority

The prompt also blocks fake social accounts, coordinated engagement, spam, impersonation, harassment campaigns, deceptive personas, scams, violence, self-harm, doxxing, and targeted abuse.

## How to test

```bash
pnpm check
pnpm build
pnpm dev
```

Then visit:

- `/labs/ask-the-smol`
- optional alias: `/labs/smol-oracle`

Manual checks:

1. the page loads
2. the Smol list loads from the existing data path
3. search filters by title, tag, creator, or id across the full loaded collection
4. the selector renders a limited visible window first, with Show more for additional matches
5. selecting different Smols changes the normalized context and collapses the selector to a compact summary on mobile
6. starter prompts submit chat messages using tappable chip buttons
7. responses come from Gemini when `GEMINI_API_KEY` works
8. otherwise the UI clearly falls back to local preview mode
9. Prompt Inspector is collapsed by default and contains normalized context, universal prompt, user message, mode, provider error, and recent history in bounded scroll areas
10. 375px, 390px, 414px, and 430px mobile widths do not require horizontal page scrolling

## Gemini environment variable

Check `GEMINI_API_KEY` in the server / Cloudflare Pages environment if the UI reports:

> Gemini key not configured or needs update.

Do not put Gemini keys in public `VITE_*` or `PUBLIC_*` frontend variables.

## Current limitations

- Chat history is local component state only.
- There is no account auth or persistent memory.
- The server trusts the client-supplied normalized context for this lab prototype.
- The live API list limit is currently requested at 5000 through the existing loader.
- The UI keeps the full loaded collection in memory, but renders a smaller visible result window first to keep mobile selection responsive.
- The fallback is intentionally small and deterministic; it proves the UX and prompt system, not full model quality.
