import type { Smol, SmolDetailResponse } from "../../types/domain";
import {
  getSnapshotAsync,
  mergeSmolsWithSnapshot,
} from "./snapshot";


export type SmolDetailLoadState = "loading" | "preparing" | "loaded" | "error" | "staleFallback";

export interface LoadSmolDetailResult {
  state: SmolDetailLoadState;
  source?: "live" | "snapshot";
  smol?: SmolDetailResponse;
  error?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isValidDetailResponse(response: SmolDetailResponse | null | undefined): response is SmolDetailResponse {
  if (!response) return false;
  const liveId = normalizeId(response.d1?.Id).trim();
  const hasTitle = Boolean(response.d1?.Title?.trim() || response.kv_do?.lyrics?.title?.trim());
  const hasMedia = Boolean(response.d1?.Song_1 || response.kv_do?.songs?.[0]?.music_id || response.kv_do?.image_base64);
  return liveId.length > 0 && hasTitle && hasMedia;
}

function mapSnapshotToDetail(snapshotSmol: Smol): SmolDetailResponse | null {
  const normalizedId = normalizeId(snapshotSmol?.Id).trim();
  if (!normalizedId) return null;
  const title = typeof snapshotSmol.Title === "string" ? snapshotSmol.Title.trim() : "";
  if (!title) return null;
  return {
    d1: {
      Id: normalizedId,
      Title: title,
      Address: snapshotSmol.Address,
      Creator: snapshotSmol.Creator || snapshotSmol.Username || snapshotSmol.artist || snapshotSmol.author,
      Song_1: snapshotSmol.Song_1,
      Mint_Token: snapshotSmol.Mint_Token,
      Mint_Amm: snapshotSmol.Mint_Amm,
      Created_At: snapshotSmol.Created_At,
    },
    kv_do: snapshotSmol.kv_do || {
      description: snapshotSmol.Description,
      lyrics: snapshotSmol.lyrics,
    },
    wf: { status: "complete" },
  };
}

export async function loadSmolDetail(id: unknown, options?: { signal?: AbortSignal }): Promise<LoadSmolDetailResult> {
  const normalizedId = normalizeId(id).trim();
  if (!normalizedId) return { state: "error", error: "Missing song id." };

  const retryDelaysMs = [750, 1500, 3000];

  for (let attempt = 0; attempt <= retryDelaysMs.length; attempt += 1) {
    try {
      const res = await fetch(`${API_URL.replace(/\/$/, "")}/${encodeURIComponent(normalizedId)}`, {
        credentials: "include",
        cache: "no-store",
        signal: options?.signal,
      });

      if (res.ok) {
        const live = (await res.json()) as SmolDetailResponse;
        if (isValidDetailResponse(live)) {
          return { state: "loaded", source: "live", smol: live };
        }
      }

      if ((res.status === 404 || res.status === 425 || res.status === 409 || res.status >= 500) && attempt < retryDelaysMs.length) {
        await delay(retryDelaysMs[attempt]);
        continue;
      }
      break;
    } catch {
      if (attempt < retryDelaysMs.length) {
        await delay(retryDelaysMs[attempt]);
        continue;
      }
      break;
    }
  }

  const snapshot = await getSnapshotAsync();
  const snapshotMatch = snapshot.find((s) => normalizeId(s.Id).trim() === normalizedId);
  if (snapshotMatch) {
    const mapped = mapSnapshotToDetail(snapshotMatch);
    if (isValidDetailResponse(mapped)) {
      return { state: "staleFallback", source: "snapshot", smol: mapped };
    }
  }

  return {
    state: "error",
    error: "Could not load this smol. It may still be preparing—please retry.",
  };
}

const API_URL = import.meta.env.PUBLIC_API_URL || 'https://api.smol.xyz';

function normalizeId(value: unknown): string {
  return typeof value === "string" ? value : String(value ?? "");
}

function isRenderableSmol(smol: Partial<Smol> | null | undefined): smol is Smol {
  if (!smol) return false;
  const id = normalizeId((smol as any).Id).trim();
  if (!id) return false;
  const title = typeof smol.Title === "string" ? smol.Title.trim() : "";
  return title.length > 0;
}

/**
 * Fetch all smols with Hybrid Strategy (Live + GalacticSnapshot Merge)
 */
export async function fetchSmols(options?: { limit?: number; signal?: AbortSignal }): Promise<Smol[]> {
  try {
    const url = new URL(`${API_URL}`);
    // Default to 5000 if no limit specified to ensure all songs load
    const limit = options?.limit ?? 5000;
    url.searchParams.set("limit", String(limit));

    // 1. Parallelize Live Fetch and Snapshot Load
    const [liveRes, snapshot] = await Promise.all([
      fetch(url.toString(), { signal: options?.signal }),
      getSnapshotAsync(),
    ]);

    if (!liveRes.ok) {
      console.warn(
        `Failed to fetch live smols: ${liveRes.statusText}, falling back to snapshot`,
      );
      return snapshot;
    }

    const data = await liveRes.json();
    const liveSmols = (data.smols || data) as Smol[];
    if (!Array.isArray(liveSmols) || liveSmols.length === 0) {
      console.warn("Live smols response empty, falling back to snapshot");
      return snapshot;
    }

    // 2. Perform Merging with pre-loaded snapshot
    const snapshotMap = new Map(snapshot.map((s) => [normalizeId(s.Id), s]));

    // Merge: Prefer Live, but fallback to Snapshot for missing critical fields
    const merged = liveSmols.map((newSmol) => {
      const normalizedId = normalizeId(newSmol.Id);
      const oldSmol = snapshotMap.get(normalizedId);
      return {
        ...newSmol,
        Id: normalizedId,
        Tags:
          newSmol.Tags && newSmol.Tags.length > 0
            ? newSmol.Tags
            : oldSmol?.Tags || [],
        Address: newSmol.Address || oldSmol?.Address || undefined,
        Minted_By: newSmol.Minted_By || oldSmol?.Minted_By || undefined,
        Username: newSmol.Username || oldSmol?.Username || undefined,
      };
    });

    // 3. Do NOT append snapshot-only songs when live API succeeded.
    // Live must remain authoritative for "latest" ordering and corpus freshness.
    // Snapshot is only a field-level fallback for known live IDs.

    // 4. DEEP VERIFICATION: Hydrate missing metadata for "Live-Only" songs
    // (Songs present in API but not in snapshot = New drops missing tags/address)
    const newItems = merged.filter(
      (s: any) =>
        !snapshotMap.has(normalizeId(s.Id)) &&
        (!s.Tags || s.Tags.length === 0 || !s.Address),
    );

    if (newItems.length > 0) {
      // console.log(`[HybridData] Found ${newItems.length} new live items. Hydrating tags...`);
      // Fetch details in parallel chunks (Batched to prevent rate limits)
      const chunkSize = 5;
      for (let i = 0; i < newItems.length; i += chunkSize) {
        const chunk = newItems.slice(i, i + chunkSize);
        await Promise.all(
          chunk.map(async (song: any) => {
            try {
              const res = await fetch(`${API_URL}/${normalizeId(song.Id)}`, { signal: options?.signal });
              if (!res.ok) return;
              const data = await res.json();
              const detail = data.d1 || data.kv_do;
              if (detail) {
                if (detail.Tags) song.Tags = detail.Tags;
                if (detail.lyrics?.style) {
                  song.Tags = [...(song.Tags || []), ...detail.lyrics.style];
                }
                if (detail.Address) song.Address = detail.Address;
                // Prefer Username if available, otherwise fallback to Creator/Address logic downstream
                if (detail.Username) song.Username = detail.Username;
                if (detail.Creator) song.Creator = detail.Creator;
                if (detail.Mint_Token) song.Mint_Token = detail.Mint_Token;
              }
            } catch (e) {
              // console.warn(`Failed to hydrate ${song.Id}`, e);
            }
          }),
        );
      }
    }

    return merged.filter((smol) => isRenderableSmol(smol)) as Smol[];
  } catch (e) {
    console.error("Fetch error, falling back to snapshot", e);
    return getSnapshotAsync();
  }
}

/**
 * Get the full snapshot directly (for components needing all tags, like RadioBuilder)
 */
export async function getFullSnapshot(): Promise<Smol[]> {
  return getSnapshotAsync();
}

/**
 * Safe fetch wrapper that guarantees a non-empty snapshot fallback.
 */
export async function safeFetchSmols(
  options?: { limit?: number; signal?: AbortSignal },
): Promise<Smol[]> {
  const smols = await fetchSmols(options);
  if (!Array.isArray(smols) || smols.length === 0) {
    return getSnapshotAsync();
  }
  return smols;
}

/**
 * Fetch liked smol IDs for the current user
 */
export async function fetchLikedSmols(signal?: AbortSignal): Promise<string[]> {
  const response = await fetch(`${API_URL}/likes`, {
    credentials: "include",
    signal,
  });
  if (!response.ok) {
    return [];
  }
  return response.json();
}

/**
 * Like a smol
 */
export async function likeSmol(smolId: string): Promise<void> {
  const response = await fetch(`${API_URL}/like`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ smol_id: smolId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to like smol: ${response.statusText}`);
  }
}

/**
 * Unlike a smol
 */
export async function unlikeSmol(smolId: string): Promise<void> {
  const response = await fetch(`${API_URL}/unlike`, {
    method: "POST",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ smol_id: smolId }),
  });

  if (!response.ok) {
    throw new Error(`Failed to unlike smol: ${response.statusText}`);
  }
}
