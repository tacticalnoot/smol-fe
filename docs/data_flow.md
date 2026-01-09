# Data Flow & Sources

**Generated**: 2026-01-09

---

## Canonical Song Object Shape

**Primary Type**: `Smol` (src/types/domain.ts:24-50)

```typescript
interface Smol {
  Id: string;                  // SHA256 hash, primary key
  Title: string;               // Song title
  Creator?: string;            // Stellar address (legacy)
  Username?: string;           // Display name
  artist?: string;             // Legacy field
  author?: string;             // Legacy field
  Song_1?: string;             // Best version music_id (UUID)
  Liked?: boolean;             // User's like state (from API)
  Address?: string;            // Creator Stellar address (canonical)
  Plays?: number;              // Play count
  Views?: number;              // View count
  Mint_Token?: string;         // SAC token contract ID (if minted)
  Mint_Amm?: string;           // AMM pool contract ID (if minted)
  Minted_By?: string;          // Wallet address of token minter/owner
  Tags?: string[];             // Extracted style tags
  lyrics?: {                   // Embedded lyrics metadata
    title?: string;
    style?: string[];
    lyrics?: string;
  };
  kv_do?: SmolKV;              // Full KV/DO payload (server-side)
  balance?: bigint;            // Client-side UI state
  minting?: boolean;           // Client-side UI state
  Created_At?: string;         // ISO timestamp
}
```

**Detail Response Type**: `SmolDetailResponse` (src/types/domain.ts:95-112)
- Used by `/[id]` endpoint
- Returns `{ d1, kv_do, wf, liked }`
- `d1` = D1 database record (lightweight)
- `kv_do` = KV/DO full payload (lyrics, image, songs array)
- `wf` = Workflow status (queued/running/complete/errored)
- `liked` = boolean indicating user's like state

---

## Data Sources

### 1. Live API (`api.smol.xyz`)

**Primary Endpoint**: `GET https://api.smol.xyz`
**Returns**: `{ smols: Smol[] }` or `Smol[]` (array at root)
**Query Params**: `?limit=N` (optional)
**Authentication**: `credentials: "include"` for likes/private songs
**Caller**: `src/services/api/smols.ts::fetchSmols()`

**Detail Endpoint**: `GET https://api.smol.xyz/:id`
**Returns**: `SmolDetailResponse`
**Caller**: SmolResults.svelte:123, Smol.svelte:136, /[id].astro:16

**Like Endpoints**:
- `GET /likes` → Returns `string[]` of song IDs
- `POST /like` → Body: `{ smol_id: string }`
- `POST /unlike` → Body: `{ smol_id: string }`

**Hydration Endpoint** (detail fallback):
**Evidence**: smols.ts:45-73 batches detail fetches for new songs missing tags
**Logic**: If song in API but not snapshot, and missing Tags/Address, fetch `/:id` to hydrate metadata

### 2. Snapshot (`public/data/GalacticSnapshot.json`)

**Location**: `/home/user/smol-fe/public/data/GalacticSnapshot.json`
**Size**: 19MB, ~359,468 lines
**Format**: `{ songs: Smol[], tagGraph?: any }` or legacy `Smol[]`
**Loader**: `src/services/api/snapshot.ts::getSnapshotAsync()`
**Caching**: In-memory cache (`cachedSnapshot`) persists across component remounts
**Fallback**: Returns empty array `[]` if fetch fails

**Access Pattern**:
1. Component calls `getSnapshotAsync()`
2. If cached, return immediately
3. Else fetch `/data/GalacticSnapshot.json` via browser fetch
4. Parse JSON, extract `songs` array
5. Cache in memory
6. Return

**Usage**:
- RadioBuilder: Line 160 (`await getFullSnapshot()`)
- ArtistsIndex: Implicit via `safeFetchSmols()` fallback chain
- unifiedTags: Line 64 (`await getSnapshotAsync()`)

### 3. Caching Layers

**No explicit caching detected** beyond:
- In-memory snapshot cache (snapshot.ts:4)
- localStorage persistence:
  - Radio state: `smol_radio_state` (RadioBuilder.svelte:193-283)
  - Playlist param: `smol:playlist` (Smol.svelte:182-185)
  - Mixtape drafts: `mixtape_draft:*` (inferred from stores/mixtape/)
- Browser fetch cache (default)
- Cloudflare CDN edge cache (deployment-level)

**No IndexedDB, no ServiceWorker detected.**

---

## Fallback Logic by Page

### /radio (RadioBuilder.svelte)

**Data Source Priority**:
1. **Snapshot first** (line 160): `smols = await getFullSnapshot()`
2. **Live API overlay** (line 167): `liveSmols = await safeFetchSmols()`
3. **Merge if live succeeds** (line 169): `smols = liveSmols` (replaces snapshot)

**Tag Source** (line 184):
- After smols loaded, `getUnifiedTags({ liveSmols: smols })` merges snapshot tags + live tags
- Ensures new songs have tags even if API doesn't return them

**Failure Mode**:
- If both snapshot and API fail, `smols = []`, tag cloud empty, IGNITE button still works but generates empty playlist

**Code Evidence**:
```svelte
// Line 158-181 (RadioBuilder.svelte)
let liveSmols: Smol[] = [];
try {
  isLoadingSmols = true;
  smols = await getFullSnapshot();  // 1. Snapshot
  liveSmols = await safeFetchSmols();  // 2. Live API
  if (liveSmols.length > 0) {
    smols = liveSmols;  // 3. Use live if available
  }
} finally {
  isLoadingSmols = false;
}
try {
  const unified = await getUnifiedTags({ liveSmols: smols });
  tagStats = unified.tags;
} catch {}
```

### /artists (ArtistsIndex.svelte)

**Data Source Priority**:
1. **Live API only** (line 122): `await safeFetchSmols()`
2. **safeFetchSmols chain**:
   - Calls `fetchSmols()` (smols.ts:12)
   - fetchSmols tries live API
   - If API fails, falls back to `getSnapshotAsync()`
   - Returns snapshot if API empty or errors

**Collected Tab Logic** (line 85-97):
- `const collectedItems = smols.filter(s => s.Minted_By === address && s.Address !== address && s.Creator !== address)`
- Depends on `Minted_By` field being present

**Failure Mode**:
- If API and snapshot both fail, `smols = []`, all tabs empty
- If `Minted_By` missing from data, collected tab always empty (even if user minted songs)

**Code Evidence**:
```typescript
// ArtistsIndex.svelte:122-128
onMount(async () => {
  try {
    const smols = await safeFetchSmols();
    artistMap = aggregateArtists(smols);
  } finally {
    isLoadingLive = false;
  }
});
```

### /[id] (SmolResults.svelte + [id].astro)

**Server-Side (SEO only)**:
- /[id].astro lines 14-38: Fetches `${API_URL}/${id}` for meta tags only
- Does NOT pass full data to component

**Client-Side (display)**:
- SmolResults.svelte line 140-142: `$effect(() => { if (id) fetchData(); })`
- fetchData() (line 120): Fetches `${API_URL}/${id}` with credentials
- No snapshot fallback for song detail
- If fetch fails, shows error UI

**Failure Mode**:
- If API down, page shows "Failed to load track" error
- SSR fetch may succeed but client fetch fail (or vice versa) if cookies/auth differ
- No retry logic

**Code Evidence**:
```typescript
// SmolResults.svelte:140-142
$effect(() => {
  if (id) fetchData();  // Runs when id prop changes
});

// Line 120-138
async function fetchData() {
  loading = true;
  try {
    const res = await fetch(`${API_URL}/${id}`, { credentials: "include" });
    if (!res.ok) throw new Error("Failed to load track");
    data = await res.json();
    if (track) selectSong(track);  // Auto-play
  } catch (e) {
    error = e.message;
  } finally {
    loading = false;
  }
}
```

### /store (CollectedSmols logic)

**Location**: `src/utils/artistCollected.js::getCollectedSmols()`

**Algorithm**:
```javascript
// Line 5-11
export function getCollectedSmols(snapshot, address) {
  const collectedCandidates = snapshot.filter(smol => smol.Minted_By === address);
  const collectedSmols = collectedCandidates.filter(
    smol => smol.Address !== address && smol.Creator !== address
  );
  return { collectedSmols, collectedCandidates };
}
```

**Logic**:
1. Find all songs where `Minted_By === user_address`
2. Exclude songs where `Address === user_address` (creator is user)
3. Exclude songs where `Creator === user_address` (legacy creator field)
4. Remaining songs = "collected" (minted by user, not created by user)

**Data Dependency**:
- Requires `Minted_By` field in snapshot/API response
- If field missing, `collectedCandidates = []`, collected tab empty

**Caller**:
- ArtistResults.svelte line 85-97 (client-side, uses live smols)
- /artist/[address].astro (SSR, uses snapshot - not shown in excerpts but inferred)

---

## Hybrid Strategy: Live + Snapshot Merge

**Implementation**: `src/services/api/smols.ts::fetchSmols()`

**Steps**:
1. **Fetch live API** (line 14-31): Try `api.smol.xyz` root endpoint
2. **Parse response** (line 26-27): Extract `data.smols || data` (supports both formats)
3. **Fallback to snapshot** (line 28-30): If empty or error, return `getSnapshotAsync()`
4. **Merge with snapshot** (line 34): `await mergeSmolsWithSnapshot(liveSmols)`
   - For each live song, prefer live data
   - If live song missing Tags/Address, backfill from snapshot
   - Add snapshot-only songs not in live API (line 68-76 in snapshot.ts)
5. **Hydrate new songs** (line 39-73): For songs in live API but not snapshot:
   - Check if Tags/Address missing
   - Batch fetch `/:id` endpoint in chunks of 5
   - Extract tags from `kv_do.lyrics.style`
   - Populate Tags, Address, Creator, Mint_Token fields

**Merge Logic** (snapshot.ts:50-80):
```typescript
export async function mergeSmolsWithSnapshot(liveSmols: Smol[]): Promise<Smol[]> {
  const snapshot = await getSnapshotAsync();
  const snapshotMap = new Map(snapshot.map(s => [s.Id, s]));

  const merged = liveSmols.map(newSmol => {
    const oldSmol = snapshotMap.get(newSmol.Id);
    return {
      ...newSmol,
      Tags: newSmol.Tags?.length > 0 ? newSmol.Tags : oldSmol?.Tags || [],
      Address: newSmol.Address || oldSmol?.Address || undefined,
      Minted_By: newSmol.Minted_By || oldSmol?.Minted_By || undefined,
    };
  });

  const liveIds = new Set(liveSmols.map(s => s.Id));
  snapshot.forEach(oldSmol => {
    if (!liveIds.has(oldSmol.Id)) {
      merged.push(oldSmol);  // Add snapshot-only songs
    }
  });

  return merged;
}
```

**Guarantees**:
- Live API is source of truth for metadata (Plays, Views, Likes, Mint status)
- Snapshot is source of truth for Tags if live API doesn't return them
- All snapshot songs included even if not in live API (preserves history)

**Risks**:
- If snapshot stale, may include deleted songs
- If snapshot missing new songs, they have no tags until hydration completes
- Hydration batching (5 at a time) may cause initial tag cloud to be incomplete
