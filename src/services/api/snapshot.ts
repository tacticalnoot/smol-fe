import type { Smol } from "../../types/domain";

// OOM FIX: Removed static JSON imports - data fetched at runtime
// Shared cache for the raw snapshot response to prevent double-fetching
let cachedFullData: { songs: Smol[], tagGraph: any } | null = null;
let cachedSnapshot: Smol[] | null = null;

/**
 * Strip heavy fields from a song to reduce memory footprint.
 * kv_do contains prompts (several KB), base64 images (100KB+), and lyrics.
 */
function stripHeavyFields(song: Smol): Smol {
  return {
    Id: song.Id,
    Title: song.Title,
    Song_1: song.Song_1,
    Address: song.Address,
    Creator: song.Creator,
    Username: song.Username,
    Created_At: song.Created_At,
    Tags: song.Tags,
    Mint_Token: song.Mint_Token,
    Mint_Amm: song.Mint_Amm,
    Minted_By: song.Minted_By,
    Liked: song.Liked,
    Plays: song.Plays,
    Views: song.Views,
    // Exclude: kv_do (huge), lyrics (full text)
  } as Smol;
}

/**
 * Fetch snapshot at runtime instead of bundling at build time
 */
export async function getSnapshotAsync(): Promise<Smol[]> {
  if (cachedSnapshot) return cachedSnapshot;

  try {
    const res = await fetch('/data/GalacticSnapshot.json');
    if (!res.ok) throw new Error(`Snapshot load failed: ${res.status}`);
    const data = await res.json();

    // Cache tagGraph separately (it's small), but strip songs immediately
    cachedFullData = { songs: [], tagGraph: data.tagGraph || null };

    // Support both legacy array and new structured object { songs: [], tagGraph: {} }
    const rawSongs = Array.isArray(data) ? data : (data.songs || []);

    // MEMORY OPTIMIZATION: Strip heavy fields immediately to prevent 13MB+ sitting in RAM
    cachedSnapshot = rawSongs.map(stripHeavyFields);
    return cachedSnapshot!;
  } catch (e) {
    console.error('[getSnapshotAsync] Failed to load snapshot:', e);
    return [];
  }
}

/**
 * Fetch the tag graph (Matrix) from the snapshot
 */
export async function getSnapshotTagGraphAsync(): Promise<any | null> {
  if (cachedFullData?.tagGraph) return cachedFullData.tagGraph;

  try {
    // If songs are already loaded, we have the graph too
    if (!cachedSnapshot) {
      await getSnapshotAsync();
    }
    return cachedFullData?.tagGraph || null;
  } catch (e) {
    return null;
  }
}

/**
 * Synchronous version for SSR compatibility - returns cached data or empty array
 * Components should use getSnapshotAsync() in onMount for full data
 */
export function getGlobalSnapshot(): Smol[] {
  // Return cached if available, otherwise empty (data will be fetched client-side)
  return cachedSnapshot || [];
}

export async function mergeSmolsWithSnapshot(liveSmols: Smol[]): Promise<Smol[]> {
  const snapshot = await getSnapshotAsync();
  const snapshotMap = new Map(snapshot.map((s) => [s.Id, s]));

  const merged = liveSmols.map((newSmol) => {
    const oldSmol = snapshotMap.get(newSmol.Id);
    return {
      ...newSmol,
      Tags:
        newSmol.Tags && newSmol.Tags.length > 0
          ? newSmol.Tags
          : oldSmol?.Tags || [],
      Address: newSmol.Address || oldSmol?.Address || undefined,
      Minted_By: newSmol.Minted_By || oldSmol?.Minted_By || undefined,
      Username: newSmol.Username || oldSmol?.Username || undefined,
    };
  });

  const liveIds = new Set(liveSmols.map((s) => s.Id));
  snapshot.forEach((oldSmol) => {
    if (!liveIds.has(oldSmol.Id)) {
      merged.push({
        ...oldSmol,
        Tags: oldSmol.Tags || [],
        Address: oldSmol.Address || undefined,
        Minted_By: oldSmol.Minted_By || undefined,
        Username: oldSmol.Username || undefined
      });
    }
  });

  return merged;
}
