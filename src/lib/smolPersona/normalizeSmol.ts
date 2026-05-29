import { getImageUrl, getSongUrl } from "../../utils/apiUrl";
import type { SmolPersonaContext } from "./types";

const TEXT_LIMITS = {
  style: 900,
  lyrics: 1800,
  prompt: 1200,
  summary: 1000,
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function compact(value: unknown, maxLen = 240): string | undefined {
  if (typeof value === "string") {
    const trimmed = value.replace(/\s+/g, " ").trim();
    return trimmed ? trimmed.slice(0, maxLen) : undefined;
  }
  if (typeof value === "number" || typeof value === "bigint") return String(value);
  return undefined;
}

function capText(value: unknown, maxLen: number): string | undefined {
  if (Array.isArray(value)) {
    return capText(value.map((item) => compact(item, 160)).filter(Boolean).join(", "), maxLen);
  }
  if (isRecord(value)) {
    const useful = Object.entries(value)
      .filter(([, entry]) => typeof entry === "string" || Array.isArray(entry))
      .map(([key, entry]) => `${key}: ${Array.isArray(entry) ? entry.join(", ") : entry}`)
      .join("\n");
    return capText(useful, maxLen);
  }
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  return trimmed.length > maxLen ? `${trimmed.slice(0, maxLen).trim()}…` : trimmed;
}

function getPath(source: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (Array.isArray(current) && /^\d+$/.test(key)) return current[Number(key)];
    if (!isRecord(current)) return undefined;
    return current[key];
  }, source);
}

function firstString(source: unknown, candidates: string[], sourceFields: Set<string>, maxLen = 240): string | undefined {
  for (const candidate of candidates) {
    const value = compact(getPath(source, candidate), maxLen);
    if (value) {
      sourceFields.add(candidate);
      return value;
    }
  }
  return undefined;
}

function firstText(source: unknown, candidates: string[], sourceFields: Set<string>, maxLen: number): string | undefined {
  for (const candidate of candidates) {
    const value = capText(getPath(source, candidate), maxLen);
    if (value) {
      sourceFields.add(candidate);
      return value;
    }
  }
  return undefined;
}

function normalizeTagsValue(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(normalizeTagsValue);
  if (typeof value === "string") {
    return value
      .split(/[#,|;]/)
      .map((tag) => tag.trim())
      .filter(Boolean);
  }
  return [];
}

function firstTags(source: unknown, candidates: string[], sourceFields: Set<string>): string[] {
  for (const candidate of candidates) {
    const tags = normalizeTagsValue(getPath(source, candidate));
    if (tags.length > 0) {
      sourceFields.add(candidate);
      return Array.from(new Set(tags.map((tag) => tag.slice(0, 40)))).slice(0, 18);
    }
  }
  return [];
}

function inferTitleFromPrompt(promptText?: string): string | undefined {
  if (!promptText) return undefined;
  const titleMatch = promptText.match(/(?:title|song title)\s*[:=-]\s*["“]?([^"”\n]{2,80})/i);
  if (titleMatch?.[1]) return titleMatch[1].trim();
  return undefined;
}

export function normalizeSmol(rawSmol: unknown): SmolPersonaContext {
  const sourceFields = new Set<string>();

  const promptText = firstText(rawSmol, [
    "prompt",
    "Prompt",
    "payload.prompt",
    "kv_do.payload.prompt",
    "metadata.prompt",
    "generationPrompt",
    "Generation_Prompt",
    "description",
    "Description",
    "kv_do.description",
  ], sourceFields, TEXT_LIMITS.prompt);

  const id = firstString(rawSmol, [
    "id",
    "Id",
    "ID",
    "smol_id",
    "tokenId",
    "hash",
    "d1.Id",
    "Address",
  ], sourceFields) || "unknown-smol";

  const title = firstString(rawSmol, [
    "title",
    "Title",
    "name",
    "Name",
    "songTitle",
    "d1.Title",
    "lyrics.title",
    "kv_do.lyrics.title",
    "metadata.title",
    "metadata.name",
  ], sourceFields) || inferTitleFromPrompt(promptText) || "Untitled Smol";

  const creator = firstString(rawSmol, [
    "creator",
    "Creator",
    "Minted_By",
    "minted_by",
    "Username",
    "username",
    "d1.Creator",
    "owner",
    "Address",
  ], sourceFields);

  const artist = firstString(rawSmol, [
    "artist",
    "Artist",
    "author",
    "metadata.artist",
    "creatorName",
  ], sourceFields);

  const tags = firstTags(rawSmol, [
    "tags",
    "Tags",
    "unifiedTags",
    "tagString",
    "keywords",
    "Keywords",
    "metadata.tags",
    "lyrics.style",
    "kv_do.lyrics.style",
  ], sourceFields);

  const styleText = firstText(rawSmol, [
    "style",
    "Style",
    "lyrics.style",
    "kv_do.lyrics.style",
    "metadata.style",
  ], sourceFields, TEXT_LIMITS.style);

  const lyricsText = firstText(rawSmol, [
    "lyrics.lyrics",
    "Lyrics",
    "lyrics",
    "kv_do.lyrics.lyrics",
    "metadata.lyrics",
  ], sourceFields, TEXT_LIMITS.lyrics);

  const explicitImage = firstString(rawSmol, [
    "image",
    "imageUrl",
    "Image",
    "cover",
    "coverUrl",
    "artwork",
    "artworkUrl",
    "thumbnail",
    "thumbnailUrl",
    "metadata.image",
    "kv_do.image",
  ], sourceFields, 1000);
  const imageUrl = explicitImage || (id !== "unknown-smol" ? getImageUrl(id) : undefined);
  if (!explicitImage && imageUrl) sourceFields.add("derived:imageUrl");

  const audioId = firstString(rawSmol, [
    "Song_1",
    "songId",
    "music_id",
    "kv_do.songs.0.music_id",
    "songs.0.music_id",
    "d1.Song_1",
  ], sourceFields);
  const explicitAudio = firstString(rawSmol, [
    "audio",
    "audioUrl",
    "Audio",
    "songUrl",
    "streamUrl",
    "url",
    "metadata.audio",
    "kv_do.songs.0.audio",
  ], sourceFields, 1000);
  const audioUrl = explicitAudio || (audioId ? getSongUrl(audioId) : id !== "unknown-smol" ? getSongUrl(id) : undefined);
  if (!explicitAudio && audioUrl) sourceFields.add(audioId ? "derived:audioUrlFromSongId" : "derived:audioUrlFromId");

  const rawSummary = firstText(rawSmol, [
    "rawSummary",
    "summary",
    "Description",
    "description",
    "kv_do.description",
    "metadata.description",
    "wf.status",
  ], sourceFields, TEXT_LIMITS.summary);

  return {
    id,
    title,
    creator,
    artist,
    tags,
    styleText,
    lyricsText,
    promptText,
    imageUrl,
    audioUrl,
    rawSummary,
    sourceFields: Array.from(sourceFields).sort(),
  };
}
