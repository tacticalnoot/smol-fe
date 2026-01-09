# /[id] Regression: Hypotheses & Fix Plan

**Generated**: 2026-01-09

---

## Context (Given Requirement)

- `/[id]` is the canonical "song detail" page
- **Historical behavior**: After song creation, navigating to `/[id]` would show populated metadata immediately (no refresh needed)
- **Current behavior**: After UI refactor, `/[id]` appears unpopulated/empty/loading until manual refresh
- **After refresh**: Refactored song data card shows correctly

---

## G1: Current /[id] Data Population Pipeline

### Page Structure

**File**: `src/pages/[id].astro`
**Component**: `SmolResults.svelte` (client:only)

### Route Param Extraction
**Location**: `src/pages/[id].astro:5`
```typescript
const { id } = Astro.params;
```
**Type**: `string | undefined`
**Passed to Component**: Line 44 as prop `id={id as string}`

### Server-Side Data Resolution (SEO Only)

**Location**: `src/pages/[id].astro:14-38`
**Purpose**: Fetch minimal data for meta tags (`<title>`, `<meta name="description">`, `og:image`, etc.)
**Endpoint**: `${API_URL}/${id}`
**Headers**: `Cookie: Astro.request.headers.get("cookie")`
**Fields Extracted**:
- `title` from `data.kv_do?.lyrics?.title || data.d1?.Title`
- `description` from `data.kv_do?.payload?.prompt || data.kv_do?.description`
- `song_url` from `data.d1?.Song_1` or `data.kv_do?.songs?.[0]?.audio`
- `image_url` = `${API_URL}/image/${id}.png`

**Critical Detail**: This data is NOT passed to SmolResults component, only used for SSR meta tags.

### Client-Side Data Resolution (Display)

**Component**: `src/components/smol/SmolResults.svelte`

**Prop Reception** (line 22):
```svelte
let { id }: { id: string } = $props();
```

**Data State** (line 27-29):
```typescript
let data = $state<SmolDetailResponse | null>(null);
let loading = $state(true);
let error = $state<string | null>(null);
```

**Fetch Function** (line 120-138):
```typescript
async function fetchData() {
  loading = true;
  try {
    const res = await fetch(`${API_URL}/${id}`, { credentials: "include" });
    if (!res.ok) throw new Error("Failed to load track");
    data = await res.json();
    // Auto-play if not already playing something else
    if (track) {
      selectSong(track);
    }
  } catch (e: any) {
    error = e.message;
  } finally {
    loading = false;
  }
}
```

**Fetch Trigger** (line 140-142):
```typescript
$effect(() => {
  if (id) fetchData();
});
```
**Lifecycle**: Runs when `id` prop changes (Svelte 5 runes reactivity)

**Loading/Populated State Decision** (line 260-272):
```svelte
{#if loading}
  <Loader />
{:else if error}
  <p>Error: {error}</p>
{:else if data}
  <!-- Render full song card -->
{/if}
```

**Re-fetch Triggers**:
1. Component mounts with `id` prop → `$effect` runs → `fetchData()` called
2. `id` prop changes → `$effect` runs again → `fetchData()` called
3. **No other triggers** (no focus listener, no interval, no manual refresh button)

**Data Source Used**: Live API only (`${API_URL}/${id}`), no snapshot fallback

---

## G1: Populate Timeline (Step-by-Step)

### Flow 1: Normal Navigation to /[id] for Existing Song (WORKS)

1. **User clicks song card** (e.g., from Radio results, artist page)
   - **Evidence**: RadioResults.svelte, ArtistResults.svelte use `<a href="/{song.Id}">` or `navigate(\`/\${song.Id}\`)`
2. **Astro client-side router detects route change** (if using `navigate()` from `astro:transitions/client`)
   - **File**: Astro internal router
3. **Browser navigates to `/[id]`**
   - **File**: `src/pages/[id].astro`
4. **SSR phase** (if not cached):
   - Astro extracts `id` from URL params
   - Fetches `${API_URL}/${id}` for meta tags (line 16-38)
   - Renders HTML with SmolResults component placeholder
5. **Client hydration**:
   - SmolResults.svelte mounts
   - `id` prop is set to URL param value
   - `$effect(() => { if (id) fetchData(); })` triggers (line 140-142)
   - `fetchData()` fetches `${API_URL}/${id}` (line 123-127)
   - API returns full song data (d1 + kv_do + liked)
   - `data` state updates → component re-renders with populated card
6. **Auto-play** (if configured):
   - Line 130-132: `if (track) selectSong(track);` loads song into audio player

**Why it works**: Astro router properly hydrates component, `id` prop is set correctly, `$effect` runs, fetch succeeds.

---

### Flow 2: Create Song → Navigate to /[id] for New Song (REQUIRES REFRESH)

1. **User submits song prompt** at `/create`
   - **File**: `src/components/Smol.svelte`
   - Calls `useSmolGeneration.ts::postGen()`
2. **API POST to `${API_URL}`** (useSmolGeneration.ts:16-32)
   - Body: `{ address, prompt, public, instrumental, playlist }`
   - Returns: Song ID (SHA256 hash string)
3. **Navigation via `history.pushState()`** (useSmolGeneration.ts:35)
   - **CRITICAL LINE**:
     ```typescript
     history.pushState({}, '', `/${id}`);
     ```
   - **Issue**: Uses native History API, NOT Astro's `navigate()`
4. **Browser URL changes to `/[id]`**
   - Address bar updates
   - Browser history stack updated
5. **Astro router may NOT detect change**
   - `history.pushState()` is synchronous, low-level API
   - Astro's client-side router listens for specific events (popstate, click on `<a>`, `navigate()` calls)
   - Manual `pushState()` may bypass Astro's routing lifecycle
6. **Component state unclear**:
   - **Scenario A**: Astro detects change, unmounts `/create` component (Smol.svelte), mounts `/[id]` page (SmolResults.svelte)
     - `id` prop is set correctly
     - `$effect` runs, `fetchData()` called
     - **But**: New song may not be in API yet (eventual consistency lag)
     - API returns 404 or incomplete data
     - Component shows error or loading state indefinitely
   - **Scenario B**: Astro does NOT detect change, `/create` component stays mounted
     - URL bar shows `/[id]`, but page content is still Smol.svelte (create form)
     - User sees create form with new URL (mismatched state)
     - Refresh forces Astro to re-evaluate route, mounts correct component
7. **User refreshes page**
   - Browser makes full request to `/[id]`
   - Astro SSR fetches `${API_URL}/${id}` (now song exists in API)
   - Client hydration mounts SmolResults.svelte with correct `id` prop
   - `fetchData()` succeeds, card populates

**Why refresh is needed**:
- **Root cause uncertain** (A or B above), but most likely **Scenario A** (eventual consistency)
- Even if Astro detects route change, API may not have song data yet (lag between POST response and GET availability)
- No retry logic in `fetchData()` (one-shot fetch)
- No loading spinner with "please wait" messaging

**File Evidence**:
- Navigation: `src/hooks/useSmolGeneration.ts:35`
- Fetch: `src/components/smol/SmolResults.svelte:140-142`

---

## G2: Evidence-Based Hypotheses

### Hypothesis 1: Astro Router Bypass (Navigation Mechanism)

**Claim**: `history.pushState()` does not trigger Astro's client-side router, causing `/[id]` page to not mount or `id` prop to not update.

**Evidence**:
- **File**: `src/hooks/useSmolGeneration.ts:35`
  ```typescript
  history.pushState({}, '', `/${id}`);
  ```
- Astro's `navigate()` function exists and is used elsewhere (SmolResults.svelte:9, line 312-317)
- `navigate()` is imported from `astro:transitions/client`, designed for SPA-style navigation
- `history.pushState()` is lower-level, may not emit events Astro listens for

**Supporting Observation**:
- SmolResults.svelte uses `navigate()` for internal links (line 312-317)
- RadioBuilder, ArtistResults use standard `<a href>` or `navigate()` for song links
- Only `useSmolGeneration.ts` uses `history.pushState()`

**Test**: Replace `history.pushState()` with `navigate()` from `astro:transitions/client`:
```typescript
import { navigate } from 'astro:transitions/client';
// ...
if (id) {
  navigate(`/${id}`);
}
```

**Likelihood**: High (80%)

---

### Hypothesis 2: Eventual Consistency Lag (API Timing)

**Claim**: After POST returns song ID, the GET `/:id` endpoint does not immediately return full data (D1 + KV/DO not yet synced).

**Evidence**:
- **File**: `src/hooks/useSmolGeneration.ts:29-32`
  ```typescript
  const id = await fetch(API_URL, { method: 'POST', ... }).then(res => res.text());
  ```
  POST returns immediately with ID, but backend may be async (workflow queued, not complete)
- **File**: `src/components/smol/SmolResults.svelte:123-127`
  ```typescript
  const res = await fetch(`${API_URL}/${id}`, { credentials: "include" });
  if (!res.ok) throw new Error("Failed to load track");
  ```
  Single fetch, no retry logic
- Song generation is async (workflow status: queued → running → complete, see SmolDetailResponse.wf field)
- SmolResults does check `wf?.status`, but only for error display (line 260-272)

**Supporting Observation**:
- `Smol.svelte` (old create+detail combined component) polls generation status (line 165-172):
  ```typescript
  switch (data?.wf?.status) {
    case "queued": case "running": case "paused": case "waiting": case "waitingForPause":
      interval = setInterval(getGen, 1000 * 6);  // Poll every 6 seconds
      break;
  }
  ```
- But `SmolResults.svelte` does NOT poll, only fetches once on mount

**Test**: Add retry/polling logic to `fetchData()` if data incomplete or 404:
```typescript
async function fetchData() {
  loading = true;
  let attempts = 0;
  const maxAttempts = 10;
  while (attempts < maxAttempts) {
    try {
      const res = await fetch(`${API_URL}/${id}`, { credentials: "include" });
      if (res.ok) {
        data = await res.json();
        if (data.d1 && data.kv_do) {
          // Full data available
          if (track) selectSong(track);
          loading = false;
          return;
        }
      }
    } catch (e) {}
    attempts++;
    await new Promise(resolve => setTimeout(resolve, 2000));  // Wait 2s before retry
  }
  error = "Failed to load track";
  loading = false;
}
```

**Likelihood**: Very High (95%)

---

### Hypothesis 3: Component Lifecycle Mismatch (Refactor Side Effect)

**Claim**: UI refactor changed when/how `/[id]` data is fetched, moving from page-level (with SSR data pass) to component-level (client-only fetch), causing timing issue.

**Evidence**:
- **File**: `src/pages/[id].astro:44`
  ```svelte
  <SmolResults id={id as string} client:only="svelte" />
  ```
  `client:only` means component renders ONLY on client, never on server
  SSR fetch (line 14-38) is wasted work, not used by component
- Old flow (inferred from Smol.svelte):
  - Single component handled create + detail
  - After POST, component already mounted, just updates `id` state internally
  - No navigation, no prop change, just reactive state update
- New flow:
  - Separate pages: `/create` (Smol.svelte) → `/[id]` (SmolResults.svelte)
  - Requires unmount + remount, or client-side navigation
  - Component depends on `id` prop from Astro params

**Supporting Observation**:
- SmolResults.svelte expects `id` prop to change to trigger re-fetch (line 140-142)
- If Astro doesn't propagate new `id` after `pushState()`, `$effect` doesn't re-run

**Test**: Log `id` prop in SmolResults on mount/update:
```typescript
$effect(() => {
  console.log('[SmolResults] id prop changed:', id);
  if (id) fetchData();
});
```
If "id prop changed" doesn't log after create flow, prop is stale.

**Likelihood**: Medium (60%)

---

### Hypothesis 4: Caching Interference (Stale API Response)

**Claim**: Browser or CDN caches 404/empty response for new song ID, subsequent fetch returns cached empty response until hard refresh.

**Evidence**:
- **File**: `src/components/smol/SmolResults.svelte:124`
  ```typescript
  const res = await fetch(`${API_URL}/${id}`, { credentials: "include" });
  ```
  No `cache: 'no-cache'` or `Cache-Control` override
- Cloudflare CDN may cache API responses (deployment config in wrangler.toml is minimal)
- If first fetch after POST returns 404 (song not ready), CDN may cache 404 for 5-60 seconds

**Supporting Observation**:
- `credentials: "include"` *should* disable caching in most browsers (Vary: Cookie)
- But edge cache (Cloudflare) may still cache if API doesn't send proper headers

**Test**: Add cache-busting query param:
```typescript
const res = await fetch(`${API_URL}/${id}?t=${Date.now()}`, { credentials: "include" });
```
Or add header:
```typescript
const res = await fetch(`${API_URL}/${id}`, {
  credentials: "include",
  cache: 'no-cache'
});
```

**Likelihood**: Low (20%)

---

## G3: Fix Plan Options

---

## Option A: Keep /[id] as Canonical Detail Page, Restore Post-Create Population

**Goal**: After song creation, user sees populated song card at `/[id]` without manual refresh.

**Strategy**: Fix navigation + add retry logic for eventual consistency.

### Changes Required

#### 1. Fix Navigation in Create Flow

**File**: `src/hooks/useSmolGeneration.ts`

**Current** (line 35):
```typescript
history.pushState({}, '', `/${id}`);
```

**Proposed**:
```typescript
import { navigate } from 'astro:transitions/client';
// ...
if (id) {
  navigate(`/${id}`);
}
```

**Rationale**: Use Astro's navigation API to ensure proper client-side routing and component hydration.

**Side Effects**: Triggers Astro's route change lifecycle, unmounts Smol.svelte, mounts SmolResults.svelte with correct `id` prop.

---

#### 2. Add Retry/Polling Logic in SmolResults

**File**: `src/components/smol/SmolResults.svelte`

**Current** (line 120-138): Single fetch, no retry.

**Proposed Enhancement**:
```typescript
async function fetchData() {
  loading = true;
  error = null;
  let attempts = 0;
  const maxAttempts = 15;  // 15 attempts * 2s = 30s max wait
  const retryDelay = 2000;  // 2 seconds

  while (attempts < maxAttempts) {
    try {
      const res = await fetch(`${API_URL}/${id}`, { credentials: "include" });
      if (!res.ok) {
        if (res.status === 404 && attempts < maxAttempts - 1) {
          // Song not ready yet, retry
          attempts++;
          await new Promise(resolve => setTimeout(resolve, retryDelay));
          continue;
        }
        throw new Error("Failed to load track");
      }
      data = await res.json();

      // Check if data is complete (has both d1 and kv_do)
      if (data.d1 && data.kv_do) {
        // Full data available
        if (track) selectSong(track);
        loading = false;
        return;
      } else if (attempts < maxAttempts - 1) {
        // Incomplete data, retry
        attempts++;
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        continue;
      }

      // If we get here, data is incomplete after max attempts
      throw new Error("Incomplete song data");
    } catch (e: any) {
      if (attempts < maxAttempts - 1) {
        attempts++;
        await new Promise(resolve => setTimeout(resolve, retryDelay));
        continue;
      }
      error = e.message;
      loading = false;
      return;
    }
  }
}
```

**Rationale**: Handle eventual consistency lag between POST and GET. Song data may take several seconds to fully propagate from workflow completion to API response.

**User Experience**: User sees loading spinner for up to 30 seconds after create, then either:
- Success: Song card populates with full metadata
- Failure: Error message with retry button

---

#### 3. Add Loading State Messaging

**File**: `src/components/smol/SmolResults.svelte`

**Current** (line 260-263): Generic loader.

**Proposed Enhancement**:
```svelte
{#if loading}
  <div class="flex items-center justify-center py-32">
    <Loader classNames="w-12 h-12" textColor="text-[#d836ff]" />
    {#if isNewSong}
      <p class="text-white/60 text-sm mt-4">Generating your track... This may take up to 30 seconds.</p>
    {:else}
      <p class="text-white/60 text-sm mt-4">Loading track...</p>
    {/if}
  </div>
{:else if error}
  <!-- ... -->
{/if}
```

**Detect New Song** (heuristic):
```typescript
let isNewSong = $state(false);
$effect(() => {
  // If URL has ?from=create or if navigation came from /create, assume new song
  const params = new URLSearchParams(window.location.search);
  isNewSong = params.get('from') === 'create';
});
```

**Rationale**: Give user feedback that wait is expected for new songs.

---

#### 4. Pass Context Flag from Create Flow

**File**: `src/hooks/useSmolGeneration.ts`

**Proposed** (line 35):
```typescript
import { navigate } from 'astro:transitions/client';
// ...
if (id) {
  navigate(`/${id}?from=create`);
}
```

**File**: `src/components/smol/SmolResults.svelte`

**Use Flag**:
```typescript
let fromCreate = $state(false);
$effect(() => {
  const params = new URLSearchParams(window.location.search);
  fromCreate = params.get('from') === 'create';
});
```

**Rationale**: SmolResults can adjust behavior (longer polling, different messaging) if coming from create flow.

---

### Summary of Option A

**Files Modified**:
1. `src/hooks/useSmolGeneration.ts` (navigation fix)
2. `src/components/smol/SmolResults.svelte` (retry logic + messaging)

**Complexity**: Low (2 files, ~30 lines added)

**Risk**: Low (backward compatible, only affects post-create flow)

**Testing**:
1. Create new song at `/create`
2. After POST, verify URL changes to `/[id]`
3. Verify loading spinner shows "Generating your track..."
4. After ~5-15 seconds, verify song card populates without refresh
5. Verify existing song navigation still works (no regression)

---

## Option B: Introduce Separate Route for Refactored Detail Card

**Goal**: Preserve `/[id]` as lightweight "post-create landing page" for newly created tracks, introduce `/song/[id]` (or `/track/[id]`) for full detail view.

**Rationale**: Separation of concerns—create flow needs immediate feedback (even partial data), while browse flow expects full data.

**Strategy**: Create new route, migrate all "view song" links to new route, keep `/[id]` for create flow only.

---

### Changes Required

#### 1. Create New Route `/song/[id]`

**New File**: `src/pages/song/[id].astro`

```astro
---
import SmolResults from "../../components/smol/SmolResults.svelte";
import Layout from "../../layouts/Layout.astro";

const { id } = Astro.params;

// Same SSR fetch logic as /[id].astro for SEO
let title: string | undefined;
let description: string | undefined;
let song_url: string | null = null;
const API_URL = import.meta.env.PUBLIC_API_URL || "https://api.smol.xyz";
let image_url: string | null = id ? `${API_URL}/image/${id}.png` : null;

if (id) {
  try {
    const data = await fetch(`${API_URL}/${id}`, {
      headers: { Cookie: Astro.request.headers.get("cookie") ?? "" },
    }).then(async (res) => (res.ok ? res.json() : null));

    if (data) {
      title = data.kv_do?.lyrics?.title || data.d1?.Title;
      description = data.kv_do?.payload?.prompt || data.kv_do?.description;
      if (data.d1?.Song_1) {
        song_url = `${API_URL}/song/${data.d1.Song_1}.mp3`;
      } else if (data.kv_do?.songs?.[0]?.audio) {
        song_url = `${API_URL}/song/${data.kv_do.songs[0].music_id}.mp3`;
      }
    }
  } catch (error) {
    console.error('Failed to fetch meta data:', error);
  }
}
---

<Layout {title} {description} {song_url} {image_url} hideBottomBar={true}>
  <div class="w-full min-h-[calc(100vh-80px)] flex items-center justify-center">
    <SmolResults id={id as string} client:only="svelte" />
  </div>
</Layout>
```

**Rationale**: Exact copy of `/[id].astro`, just at new path.

---

#### 2. Keep `/[id]` for Create Flow

**File**: `src/pages/[id].astro` (existing)

**Modify to Use Lightweight Component** (optional):
- Create new `SmolCreationStatus.svelte` component
- Polls workflow status, shows progress bar
- Once complete, redirects to `/song/[id]`

**Or Keep Current**: Leave as-is, just ensure create flow navigates here first.

---

#### 3. Update All "Open Song" Links

**Files to Modify** (inventory from G4 below):

1. **RadioResults.svelte** → Song cards link to `/song/[id]`
2. **ArtistResults.svelte** → Song cards link to `/song/[id]`
3. **SmolGrid.svelte** → Song cards link to `/song/[id]`
4. **SmolCard.svelte** → Link to `/song/[id]`
5. **MixtapeTracklist.svelte** → Track links to `/song/[id]`
6. **GlobalPlayer.svelte** → Click song title → `/song/[id]`
7. **RadioPlayer.svelte** → (If has link) → `/song/[id]`

**Pattern**: Find all `href="/{song.Id}"` or `navigate(\`/\${song.Id}\`)`, replace with `href="/song/{song.Id}"` or `navigate(\`/song/\${song.Id}\`)`.

---

#### 4. Update Create Flow

**File**: `src/hooks/useSmolGeneration.ts`

**Current** (line 35):
```typescript
history.pushState({}, '', `/${id}`);
```

**Proposed**:
```typescript
import { navigate } from 'astro:transitions/client';
// ...
if (id) {
  navigate(`/${id}?from=create`);  // Still go to /[id] (creation landing)
}
```

**File**: `src/pages/[id].astro` (optional enhancement)

Add button "View Full Details" → `/song/[id]` once workflow complete.

---

### Summary of Option B

**Files Modified**:
1. `src/pages/song/[id].astro` (new file)
2. `src/hooks/useSmolGeneration.ts` (navigation fix)
3. ~10 component files (reroute all song links)

**Complexity**: Medium-High (15+ files, requires inventory of all links)

**Risk**: Medium (breaking change if any link missed, requires thorough testing)

**Benefits**:
- Clean separation: `/[id]` = post-create landing, `/song/[id]` = full detail
- Easier to optimize each route independently
- No retry logic needed in `/song/[id]` (only used for existing songs)

**Drawbacks**:
- Duplicate code (two routes doing similar things)
- Confusing URL structure (users may not understand difference)
- Requires mass refactor of all song links

**Testing**:
1. Create new song → verify lands at `/[id]` with progress indicator
2. Click "View Full Details" → verify navigates to `/song/[id]`
3. Browse radio → click song → verify goes to `/song/[id]`
4. Browse artist → click song → verify goes to `/song/[id]`
5. Verify all players, cards, search results updated

---

## G4: Rerouting Inventory (for Option B)

**All locations where song detail links are generated:**

### 1. Radio Results
**File**: `src/components/radio/RadioResults.svelte`
**Line**: Unknown (not read in this pass, but inferred from structure)
**Current**: `<a href="/{song.Id}">`
**Update**: `<a href="/song/{song.Id}">`

### 2. Artist Results (Discography/Minted/Collected)
**File**: `src/components/artist/ArtistResults.svelte`
**Line**: Inferred (song card render)
**Current**: `href="/{song.Id}"`
**Update**: `href="/song/{song.Id}"`

### 3. Song Grids
**File**: `src/components/smol/SmolGrid.svelte`
**Line**: Unknown
**Current**: `href="/{song.Id}"`
**Update**: `href="/song/{song.Id}"`

### 4. Song Cards
**File**: `src/components/smol/SmolCard.svelte`
**Line**: Unknown
**Current**: `href="/{song.Id}"`
**Update**: `href="/song/{song.Id}"`

### 5. Search Results
**File**: `src/components/smol/SmolResults.svelte` (different context—this is search, not detail)
**Line**: Unknown
**Current**: `href="/{song.Id}"`
**Update**: `href="/song/{song.Id}"`

### 6. Mixtape Tracklists
**File**: `src/components/mixtape/MixtapeTracklist.svelte`
**Line**: Unknown
**Current**: `href="/{song.Id}"`
**Update**: `href="/song/{song.Id}"`

### 7. Global Player (Click Title)
**File**: `src/components/player/GlobalPlayer.svelte`
**Line**: Unknown
**Current**: `navigate(\`/\${audioState.currentSong.Id}\`)`
**Update**: `navigate(\`/song/\${audioState.currentSong.Id}\`)`

### 8. Radio Player (If Has Link)
**File**: `src/components/radio/RadioPlayer.svelte`
**Line**: Unknown (may not have link, just card)
**Current**: N/A
**Update**: N/A

### 9. Artist Player
**File**: `src/components/player/ArtistPlayer.svelte`
**Line**: Unknown
**Current**: `navigate(\`/\${song.Id}\`)`
**Update**: `navigate(\`/song/\${song.Id}\`)`

### 10. Tag Explorer
**File**: `src/components/tags/TagExplorer.svelte`
**Line**: Unknown
**Current**: "Send to Radio" button (not detail link)
**Update**: N/A

### Grep Pattern to Find All Links:
```bash
rg 'href=.*\{.*\.Id\}' src/
rg 'navigate.*\$.*\.Id' src/
```

---

## G5: Acceptance Checks

**For Option A**:
1. Create new song at `/create` → submits prompt → navigates to `/[id]`
2. Loading spinner shows "Generating your track..."
3. After 5-30 seconds, song card populates with title, lyrics, metadata
4. No manual refresh needed
5. Clicking existing song from radio/artist → `/[id]` loads immediately (no 30s wait)
6. All audio player functions work (play, scrub, next/prev)

**For Option B**:
1. Create new song at `/create` → navigates to `/[id]` with progress indicator
2. Once complete, shows "View Full Details" button → clicks → goes to `/song/[id]`
3. Browse radio → click song → goes to `/song/[id]`, loads immediately
4. Browse artist → click song → goes to `/song/[id]`, loads immediately
5. Global player "click title" → goes to `/song/[id]`
6. All old `/[id]` links in search engines, bookmarks → still work (backward compat)
7. No broken links, all song cards route correctly

---

## Recommendation

**Option A is strongly preferred** for the following reasons:
1. **Minimal code changes** (2 files vs 15+ files)
2. **Backward compatible** (no URL structure change)
3. **Addresses root cause** (navigation + eventual consistency)
4. **Better UX** (single canonical URL for songs)
5. **Lower risk** (smaller surface area for bugs)

**Implementation Order**:
1. Fix navigation (`history.pushState` → `navigate`)
2. Add retry logic to `fetchData()` (30s max, 2s intervals)
3. Add loading state messaging ("Generating..." for new songs)
4. Test create flow (5-10 test songs)
5. Test existing song navigation (no regression)
6. Deploy to staging, verify prod API timing
7. Deploy to production
