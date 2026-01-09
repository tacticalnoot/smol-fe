# Routes & Pages

**Generated**: 2026-01-09

---

## Route Inventory

All routes mapped from `src/pages/*.astro` and `src/pages/**/*.astro`.

---

### `/` (Home)
**File**: `src/pages/index.astro`
**Component**: `GlobalPlayer.svelte` (client:load)
**Data Sources**: None (delegated to GlobalPlayer component)
**Gating**: None
**Dynamic Params**: None
**Purpose**: Landing page with embedded audio player

---

### `/create` (Song Generation)
**File**: `src/pages/create.astro`
**Component**: `Smol.svelte` (client:only)
**Data Sources**: None on mount; user submits prompt → POST to `api.smol.xyz`
**Gating**: Requires authentication (`userState.contractId`)
**Dynamic Params**: `?playlist=ID` (optional, passed to Smol component)
**Navigation Flow**:
1. User fills prompt → clicks submit
2. `useSmolGeneration.ts::postGen()` calls API
3. API returns song ID
4. **Critical**: `history.pushState({}, '', \`/\${id}\`)` (line 35) - uses native history API, NOT Astro navigate
5. Browser URL changes to `/[id]` but Astro may not hydrate properly

**Evidence**: `src/hooks/useSmolGeneration.ts:35`

---

### `/[id]` (Song Detail)
**File**: `src/pages/[id].astro`
**Route Param**: `id` (SHA256 hash string)
**Component**: `SmolResults.svelte` (client:only)
**Data Sources**:
- **SSR** (lines 14-38): Fetches `${API_URL}/${id}` for SEO meta tags only (title, description, image, song_url)
- **Client** (SmolResults.svelte:140-142): Component fetches same endpoint on mount via `$effect(() => { if (id) fetchData(); })`
**Gating**: None (public page)
**Navigation Sources**:
- Create flow: `useSmolGeneration.ts:35` (history.pushState)
- Radio results: RadioResults.svelte (click song card)
- Artist page: ArtistResults.svelte (click song)
- Search/explore: Various components
**Query Params**: `?from=radio` or `?from=artist` (back navigation context, SmolResults.svelte:43-52)

**Known Issue**: Post-create navigation uses `history.pushState()`, which may not trigger Astro's client-side router. SmolResults expects `id` prop to change to trigger `$effect`, but prop may not update if Astro doesn't re-render.

**Evidence**:
- SSR fetch: `src/pages/[id].astro:14-38`
- Client fetch: `src/components/smol/SmolResults.svelte:140-142`

---

### `/radio` (Radio Station Builder)
**File**: `src/pages/radio.astro`
**Component**: `RadioBuilder.svelte` (client:load)
**Data Sources**:
- Snapshot: `/data/GalacticSnapshot.json` (loaded on mount, line 160)
- Live API: `api.smol.xyz` root endpoint (line 167)
- Merged via `getUnifiedTags()` (line 184)
**Gating**: None
**Query Params**:
- `?play=SONG_ID` (auto-generate station from song's tags, line 232-258)
- `?tag=TAG1&tag=TAG2` (pre-select tags, line 261-266)
**State Persistence**: `localStorage.smol_radio_state` (line 193-283)

**Comment on Line 4**: `// LIVE DATA: RadioBuilder now fetches smols on mount, no more snapshot needed!`
**Reality**: Code still loads snapshot first (line 160), then overlays live API. Comment is outdated.

**Evidence**: `src/pages/radio.astro:4`, `src/components/radio/RadioBuilder.svelte:160-189`

---

### `/artists` (Artist Directory)
**File**: `src/pages/artists.astro`
**Component**: `ArtistsIndex.svelte` (client:load)
**Data Sources**: Live API via `safeFetchSmols()` on mount (ArtistsIndex.svelte:122)
**Gating**: None
**Tabs**: None (single view: artist cards with discography count)
**Sort Modes**: "Fresh Drops" (by latest Created_At) or "Top Artists" (by song count)

**Evidence**: `src/components/artist/ArtistsIndex.svelte:122-128`

---

### `/artist/[address]` (Individual Artist Page)
**File**: `src/pages/artist/[address].astro`
**Route Param**: `address` (Stellar address, 56 chars)
**Component**: `ArtistResults.svelte` (passed props from SSR or fetches on mount)
**Data Sources**:
- **SSR**: Likely passes snapshot-filtered data (not shown in excerpts, inferred)
- **Client**: `safeFetchSmols()` on mount (ArtistResults.svelte:66-118)
**Gating**: None
**Tabs**:
1. **Discography** (default): All songs where `Address === address || Creator === address`
2. **Minted**: Discography filtered to `Mint_Token !== null`
3. **Collected**: Songs where `Minted_By === address && Address !== address && Creator !== address`
4. **Tags**: Top 4 tags from artist's discography
**Query Params**: `?play=SONG_ID` (auto-play song, handled by component state)

**Collected Tab Issue**: Depends on `Minted_By` field. If missing from API/snapshot, tab is always empty.

**Evidence**: `src/components/artist/ArtistResults.svelte:85-97`

---

### `/collected` (User's Collected Songs)
**File**: `src/pages/collected.astro`
**Component**: Unknown (not read in this pass)
**Data Sources**: Likely uses `artistCollected.js::getCollectedSmols()` with `userState.contractId`
**Gating**: Requires authentication
**Purpose**: Show songs minted by user but not created by user

---

### `/liked` (User's Liked Songs)
**File**: `src/pages/liked.astro`
**Component**: Unknown (not read in this pass)
**Data Sources**: `GET ${API_URL}/likes` returns `string[]` of song IDs, then fetch full songs
**Gating**: Requires authentication
**Evidence**: `src/services/api/smols.ts:105-114`

---

### `/created` (User's Created Songs)
**File**: `src/pages/created.astro`
**Component**: Unknown (not read in this pass)
**Data Sources**: Filter all songs where `Address === userState.contractId || Creator === userState.contractId`
**Gating**: Requires authentication

---

### `/store` (Premium Features)
**File**: `src/pages/store.astro`
**Component**: Unknown (not read in this pass)
**Data Sources**: Unknown
**Gating**: None (but purchases require authentication)
**Purpose**: Premium upgrade store (showcase reel, premium headers, etc.)

---

### `/mixtapes` (Mixtape Browser)
**File**: `src/pages/mixtapes/index.astro`
**Component**: Unknown (not read in this pass)
**Data Sources**: `src/services/api/mixtapes.ts` (GET /mixtapes)
**Gating**: None
**Purpose**: Browse published mixtapes

---

### `/mixtapes/[id]` (Individual Mixtape)
**File**: `src/pages/mixtapes/[id].astro`
**Route Param**: `id` (mixtape ID)
**Component**: `MixtapeDetailView.svelte` (inferred)
**Data Sources**: `GET ${API_URL}/mixtapes/${id}`
**Gating**: None
**Purpose**: View/play mixtape

---

### `/tags` (Tag Explorer)
**File**: `src/pages/tags.astro`
**Component**: `TagExplorer.svelte` (inferred)
**Data Sources**: `getUnifiedTags()` (snapshot + live merge)
**Gating**: None
**Purpose**: Browse/search all tags, "Send to Radio" button

---

### `/account` (User Settings)
**File**: `src/pages/account.astro`
**Component**: `Account.svelte` (inferred)
**Data Sources**: `userState`, `balances`, upgrades
**Gating**: Requires authentication
**Purpose**: Wallet info, logout, preferences

---

### `/kale` (KALE Token Info)
**File**: `src/pages/kale.astro`
**Component**: `KalePage.svelte` (inferred)
**Data Sources**: On-chain queries via `stellar-sdk`
**Gating**: None
**Purpose**: KALE token info, faucet, transfer

---

### `/playlist/[playlist]` (Playlist View)
**File**: `src/pages/playlist/[playlist].astro`
**Route Param**: `playlist` (playlist ID)
**Component**: Unknown
**Data Sources**: Unknown (may be server-rendered or fetched client-side)
**Gating**: Unknown
**Purpose**: Display playlist (likely legacy or admin feature)

---

### `/onboarding/passkey` (Passkey Setup)
**File**: `src/pages/onboarding/passkey.astro`
**Component**: `PasskeySplash.svelte` (inferred)
**Data Sources**: `passkey-kit` library
**Gating**: Requires authentication intent
**Purpose**: WebAuthn passkey enrollment

---

## API Routes

### `POST /api/radio/ai`
**File**: `src/pages/api/radio/ai.ts`
**Method**: POST
**Body**: `{ context: string }` (user mood/description or selected tags)
**Returns**: `{ playlistName: string, tags: string[] }`
**Purpose**: AI-powered radio station naming + tag suggestion via Gemini
**Caller**: RadioBuilder.svelte:111-138

**Evidence**: `src/components/radio/RadioBuilder.svelte:111-138`

### `GET /api/artist/badges/[address]`
**File**: `src/pages/api/artist/badges/[address].ts`
**Method**: GET
**Route Param**: `address` (Stellar address)
**Returns**: `{ premiumHeader: boolean, goldenKale: boolean }`
**Purpose**: Check if artist has purchased premium upgrades
**Caller**: ArtistResults.svelte:174-186

**Evidence**: `src/components/artist/ArtistResults.svelte:174-186`

---

## Navigation Patterns

### Internal Navigation (Client-Side)
**Method 1**: `navigate()` from `astro:transitions/client`
- Used in: SmolResults.svelte:312-317, RadioPlayer components
- Example: `navigate(\`/artist/\${address}?play=\${id}\`)`

**Method 2**: `history.pushState()`
- Used in: useSmolGeneration.ts:35 (create flow), useSmolGeneration.ts:57 (retry flow)
- **Issue**: Does not trigger Astro's client-side router hydration

**Method 3**: `<a href=...>` links
- Used in: Static Astro pages
- Triggers full page navigation (loses client state unless persisted)

### External Links
- Song sharing: `navigator.share()` or clipboard copy (SmolResults.svelte:222-232)
- API calls: `fetch()` with credentials

---

## Gating Logic

**Authentication Check**: `isAuthenticated()` from `src/stores/user.svelte.ts`
- Returns `true` if `userState.contractId && userState.keyId` exist
- Used by: Mint buttons, trade buttons, create page, account pages

**Wallet Guard**: `OnboardingGuard.svelte` (wraps authenticated pages)
- Shows splash screen if not authenticated
- Triggers passkey flow or wallet connect

**Premium Features**: `isUpgradeActive()` from `src/stores/upgrades.svelte.ts`
- Checks localStorage for purchased upgrades
- Used by: Store page, artist showcase reel, premium headers

**Evidence**:
- Authentication: `src/stores/user.svelte.ts` (exports `isAuthenticated()`)
- Upgrades: `src/stores/upgrades.svelte.ts`
- Onboarding guard: `src/components/onboarding/OnboardingGuard.svelte`

---

## Dynamic Route Params

- `[id]` → Song ID (SHA256 hash, 64 hex chars)
- `[address]` → Stellar address (56 chars, starts with `C` or `G`)
- `mixtapes/[id]` → Mixtape ID (UUID or hash)
- `playlist/[playlist]` → Playlist ID (unknown format)
- `api/artist/badges/[address]` → Stellar address
