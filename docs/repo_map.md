# Repository Map

**Generated**: 2026-01-09
**Repo**: tacticalnoot/smol-fe
**Branch**: claude/repo-comprehension-mapping-D3Amt

---

## Stack & Entry Points

### Core Technologies
- **Framework**: Astro 5.14.1 (SSR mode, `output: 'server'`)
- **UI Library**: Svelte 5.39.9 (Runes API)
- **Deployment**: Cloudflare Pages (adapter: `@astrojs/cloudflare` 12.6.9)
- **Build**: Vite with node polyfills, Tailwind CSS 4.x
- **Package Manager**: pnpm 10.18.1
- **Node Memory**: 4GB allocated (`--max-old-space-size=4096`)

### Key Dependencies
- `stellar-sdk` 14.2.0 (blockchain integration)
- `passkey-kit` 0.11.3 (WebAuthn authentication)
- `smol-sdk` (local, linked from `ext/smol-sdk`)
- `comet-sdk` (local, linked from `ext/comet-sdk`)
- `@google/generative-ai` 0.24.1 (Gemini AI for radio station naming/mood tagging)

### Entry Points

**Pages** (`src/pages/`):
- `index.astro` - Home page
- `create.astro` - Song generation interface (wraps `Smol.svelte`)
- `[id].astro` - Song detail page (wraps `SmolResults.svelte`)
- `radio.astro` - Radio station builder
- `artists.astro` - Artist directory
- `artist/[address].astro` - Individual artist page
- `collected.astro` - User's collected songs
- `liked.astro` - User's liked songs
- `created.astro` - User's created songs
- `store.astro` - Premium features store
- `mixtapes/index.astro` - Mixtape browser
- `mixtapes/[id].astro` - Individual mixtape page
- `tags.astro` - Tag explorer
- `account.astro` - User account settings
- `kale.astro` - KALE token page
- `playlist/[playlist].astro` - Playlist view
- `onboarding/passkey.astro` - Passkey setup

**API Routes** (`src/pages/api/`):
- `radio/ai.ts` - AI-powered radio station generation endpoint
- `artist/badges/[address].ts` - Artist badge/upgrade status endpoint

**Core Stores** (`src/stores/`):
- `audio.svelte.ts` - Global audio player state (Svelte 5 runes, pure state)
- `user.svelte.ts` - Authentication & wallet state
- `balance.svelte.ts` - Token balance tracking
- `mixtape.svelte.ts` / `mixtape/` - Mixtape builder state
- `upgrades.svelte.ts` - Premium feature flags
- `ui.svelte.ts` - UI state (modals, dialogs)
- `background.svelte.ts` - Background effects
- `preferences.svelte.ts` - User preferences

**Core Services** (`src/services/`):
- `api/smols.ts` - Song data fetching with hybrid strategy
- `api/snapshot.ts` - Snapshot loading and caching
- `api/mixtapes.ts` - Mixtape CRUD operations
- `tags/unifiedTags.ts` - Tag aggregation (snapshot + live merge)
- `ai/gemini.ts` - Gemini AI integration

**Data Files**:
- `public/data/GalacticSnapshot.json` (19MB, ~359k lines) - Full snapshot of songs, tags, metadata
- `src/data/minter-cache.json` (empty, unused)

**Deployment Config**:
- `wrangler.toml` - Cloudflare Pages configuration
- `astro.config.mjs` - Astro SSR + adapter config

---

## Mental Model: Radio Station Build & Play Flow

1. **User visits /radio** → `RadioBuilder.svelte` mounts
2. **Component loads snapshot** → `getFullSnapshot()` fetches `/data/GalacticSnapshot.json` (client-side, cached)
3. **Tries live API** → `safeFetchSmols()` fetches `api.smol.xyz` root endpoint
4. **Merges data** → If live API succeeds, merge with snapshot for complete tags/metadata
5. **Builds tag cloud** → `getUnifiedTags()` aggregates all tags from merged song data, sorted by popularity/frequency/recent/alphabetical
6. **User selects tags** → Up to 5 tags, stored in local component state
7. **User clicks IGNITE** → `generateStation()` scores all songs using tiered matching:
   - Tier 1: Exact tag match (100pts)
   - Tier 2: Substring/broad match (75pts)
   - Tier 3: Related tag via `TAG_RELATIONSHIPS` map (40pts)
   - Order weighting: 1st tag = 100%, 2nd = 90%, 3rd = 80% (decay 0.1 per slot)
   - Synergy bonus: +30% for songs matching multiple selected tags
   - Popularity: `(Plays * 0.01) + (Views * 0.005)` (minimal weight, tie-breaker only)
   - Recency bonus: Up to 50pts for songs <30 days old, linear decay
   - Random jitter: 0-15pts for variety
   - History penalty: 0 if song was in previous batch (strict deduplication)
8. **Smart shuffle** → DJ-style sequencing to prevent artist clustering, optimize flow via tag overlap
9. **Playlist ready** → First 20 songs selected, state persisted to `localStorage`
10. **Playback starts** → Song 0 loads into `audioState` via `selectSong()`, global player activates

---

## Risk List: Local vs Production Mismatches

### 1. **Snapshot Staleness** (src/services/api/snapshot.ts, public/data/GalacticSnapshot.json)
**Risk**: Snapshot is 19MB static file updated manually. If not regenerated, prod sees old data. RadioBuilder comment says "no more snapshot needed" but code still loads it first as fallback.
**Evidence**: Line 160 in RadioBuilder.svelte always calls `getFullSnapshot()`, then line 167 tries `safeFetchSmols()`.
**Mismatch**: Local dev may have newer snapshot than deployed build if not committed/pushed.

### 2. **Environment Variables** (multiple files import from `import.meta.env`)
**Risk**: Different values for `PUBLIC_API_URL`, `PUBLIC_SMOL_CONTRACT_ID`, `PUBLIC_KALE_SAC_ID`, `PUBLIC_RPC_URL`, `PUBLIC_NETWORK_PASSPHRASE`, `PUBLIC_GEMINI_API_KEY` between local `.env` and Cloudflare Pages env vars.
**Evidence**: Used in ~20+ files (SmolResults.svelte:24, RadioBuilder.svelte:38, useSmolGeneration.ts:8, SmolResults.svelte:188-194).
**Mismatch**: Local may use testnet, prod uses mainnet; or API URL differs.

### 3. **SSR Hydration Mismatches** (Astro SSR + client-only components)
**Risk**: Pages use `client:only="svelte"` extensively (SmolResults, RadioBuilder, ArtistsIndex). If server-rendered data differs from client fetch, hydration fails or shows stale data briefly.
**Evidence**: SmolResults.svelte is `client:only`, but /[id].astro does SSR fetch for SEO (lines 14-38). ArtistsIndex.svelte is `client:load`, fetches live on mount (line 122).
**Mismatch**: SSR passes different data shape than client expects, or client refetches immediately, wasting SSR work.

### 4. **Cache Headers & CDN** (Cloudflare Pages CDN)
**Risk**: Cloudflare caches responses based on default rules. If API responses cached at edge but not versioned, users see stale song lists.
**Evidence**: All API calls use `credentials: "include"` (smols.ts:124, SmolResults.svelte:124), which may prevent edge caching but not guarantee fresh data.
**Mismatch**: Prod CDN cache may serve stale `/` endpoint while local dev bypasses cache.

### 5. **Base Path / Public Path** (astro.config.mjs has no `base` set)
**Risk**: If deployed to subdirectory or custom domain, asset paths break.
**Evidence**: Snapshot fetched via `fetch('/data/GalacticSnapshot.json')` (snapshot.ts:13), assumes root path. Image URLs use `${API_URL}/image/${id}.png` (hardcoded).
**Mismatch**: Local uses `localhost`, prod uses custom domain; if base path changes, static assets 404.

### 6. **Memory / Bundle Size** (package.json:8 sets 4GB node memory)
**Risk**: Build OOM if snapshot grows. Vite may fail to bundle 19MB JSON if imported statically.
**Evidence**: Comment "OOM FIX: Removed static JSON imports" (snapshot.ts:3). Build script allocates 4GB memory.
**Mismatch**: Local dev machine has more memory than CI/CD runner; prod build may timeout or fail.

### 7. **Node Polyfills** (vite-plugin-node-polyfills for `buffer`)
**Risk**: Cloudflare Workers runtime doesn't support Node.js `buffer` natively. Polyfill adds bundle size.
**Evidence**: astro.config.mjs:30-32 includes `nodePolyfills({ include: ['buffer'] })`.
**Mismatch**: Local Node.js has native buffer, prod uses polyfill; subtle differences in crypto/binary ops.

### 8. **Minted_By Field Availability** (src/utils/artistCollected.js, ArtistResults.svelte:85-97)
**Risk**: "Collected" tab relies on `Minted_By` field. If API doesn't return this, tab is empty.
**Evidence**: ArtistResults.svelte line 85-90 filters `s.Minted_By === address`. Snapshot may have `Minted_By`, but live API may not.
**Mismatch**: Localhost uses snapshot with `Minted_By`, prod uses live API without it → collected tab empty.

### 9. **Tag Synchronization** (unifiedTags.ts, RadioBuilder.svelte)
**Risk**: Tag counts differ if snapshot and live API diverge. Radio tag cloud may show tags with 0 songs.
**Evidence**: unifiedTags.ts merges snapshot + live tags (line 97-98). If snapshot has tags from deleted songs, they persist.
**Mismatch**: Local sees stale snapshot tags, prod sees fresh API (or vice versa if snapshot not updated).

### 10. **Client-Side Navigation** (useSmolGeneration.ts:35 uses `history.pushState`)
**Risk**: After creating song, navigation uses `history.pushState()` instead of Astro's `navigate()`. Astro may not detect route change, causing /[id] to not refetch data.
**Evidence**: useSmolGeneration.ts line 35: `history.pushState({}, '', \`/\${id}\`);`. SmolResults.svelte line 140: `$effect(() => { if (id) fetchData(); })` expects id prop change, but pushState doesn't trigger Astro hydration.
**Mismatch**: Local dev may auto-reload, prod doesn't; user sees blank /[id] until manual refresh.
