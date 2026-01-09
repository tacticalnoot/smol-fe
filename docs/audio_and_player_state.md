# Audio & Player State

**Generated**: 2026-01-09

---

## Architecture Overview

**Central Store**: `src/stores/audio.svelte.ts`
- **Type**: Svelte 5 runes (`$state`, `$derived`)
- **Philosophy**: Pure state management, no DOM manipulation or side effects in store
- **Persistence**: None (ephemeral, resets on page refresh)
- **Web Audio API**: Initialized in store but managed by `AudioManager.svelte` component

---

## State Schema

### `audioState` Object
**Location**: `src/stores/audio.svelte.ts:9-34`

```typescript
export const audioState = $state<{
  playingId: string | null;          // ID of currently playing song (null = paused)
  currentSong: Smol | null;          // Full song object
  audioElement: HTMLAudioElement | null;  // Reference to <audio> element
  progress: number;                  // Playback progress (0-100)
  songNextCallback: (() => void) | null;  // Next song handler (registered by pages)
  songPrevCallback: (() => void) | null;  // Previous song handler
  audioContext: AudioContext | null;      // Web Audio API context
  analyser: AnalyserNode | null;          // FFT analyzer for visualizations
  sourceNode: MediaElementAudioSourceNode | null;  // Audio source node
  duration: number;                  // Song duration in seconds
  repeatMode: "off" | "once" | "one";     // Repeat mode
}>({ /* defaults */ });
```

**Key Invariant**: `playingId === currentSong.Id` means "playing". If `playingId === null`, audio is paused (even if `currentSong` is set).

---

## Core Functions

### `selectSong(songData: Smol | null)`
**Location**: Line 109-117
**Purpose**: Load a new song into the player (may or may not auto-play)
**Side Effects**: Sets `currentSong` and `playingId`
**Caller**: All player components (RadioPlayer, SmolResults, ArtistPlayer)

```typescript
export function selectSong(songData: Smol | null) {
  if (songData) {
    audioState.currentSong = songData;
    audioState.playingId = songData.Id;  // Triggers play
  } else {
    audioState.currentSong = null;
    audioState.playingId = null;
  }
}
```

### `togglePlayPause()`
**Location**: Line 122-134
**Purpose**: Toggle between play and pause for current song
**Logic**:
- If `playingId === currentSong.Id` → Pause (set `playingId = null`)
- Else → Play (set `playingId = currentSong.Id`)

### `seek(progress: number)`
**Location**: Line 97-104
**Purpose**: Scrub to specific time (progress 0-100)
**Side Effects**: Updates `audioElement.currentTime` and `audioState.progress`

### `updateProgress(currentTime: number, duration: number)`
**Location**: Line 85-92
**Purpose**: Called by `AudioManager` on `timeupdate` event
**Updates**: `audioState.duration` and `audioState.progress`

### `registerSongNextCallback(callback: (() => void) | null)`
**Location**: Line 159-161
**Purpose**: Allow pages to control what plays next (e.g., Radio playlist, artist discography)
**Caller**: RadioBuilder.svelte:873-878, ArtistResults.svelte (inferred)

### `playNextSong()` / `playPrevSong()`
**Location**: Line 173-186
**Purpose**: Invoke registered callbacks
**Caller**: GlobalPlayer next/prev buttons, keyboard shortcuts

---

## Audio Rendering Component

### `AudioManager.svelte`
**Location**: `src/components/audio/AudioManager.svelte`
**Purpose**: Render `<audio>` element, wire events to store functions
**Lifecycle**:
1. Mounts `<audio>` element
2. Calls `setAudioElement(audioRef)` to register in store
3. Listens to `timeupdate`, `ended`, `loadedmetadata` events
4. Updates store via `updateProgress()`, calls `playNextSong()` on end
5. Initializes Web Audio API via `initAudioContext()`

**Evidence**: Inferred from audio.svelte.ts API surface and global player usage

---

## Web Audio API (Visualizations)

### Initialization: `initAudioContext(force = false)`
**Location**: Line 194-301
**Purpose**: Create Web Audio API context + analyzer node for visualizations
**Strategy**:
- Uses global window cache `__SMOL_AUDIO_CONTEXT__` for HMR persistence
- Reuses context across component remounts
- Force reset if `force = true` (recovery from errors)
- **iOS Workaround**: Skips Web Audio on iOS devices (line 199-202) due to autoplay restrictions

**Key Logic**:
```typescript
if (isIOSDevice()) {
  teardownAudioContext();  // iOS can't use Web Audio reliably
  return;
}
if ((window as any).__SMOL_AUDIO_CONTEXT__ && !force) {
  // Reuse cached context
  audioState.audioContext = cached.context;
  audioState.analyser = cached.analyser;
  audioState.sourceNode = cached.source;
  return;
}
// Create new context
const ctx = new AudioContext();
const analyser = ctx.createAnalyser();
analyser.fftSize = 256;
const source = ctx.createMediaElementSource(audioElement);
source.connect(analyser);
analyser.connect(ctx.destination);
```

**Analyzer Usage**:
- `MiniVisualizer.svelte` (waveform bars)
- Album art visualizations (not shown in excerpts)

**Evidence**: `src/stores/audio.svelte.ts:194-301`

---

## Player UI Components

### `GlobalPlayer.svelte`
**Location**: `src/components/player/GlobalPlayer.svelte`
**Purpose**: Persistent bottom bar player, always visible
**Features**:
- Play/pause button
- Scrubber (progress bar with seek)
- Next/prev buttons (call `playNextSong()`, `playPrevSong()`)
- Song title, artist link
- Album art
- Repeat mode toggle
**State**: Reads from `audioState`, calls store functions

### `RadioPlayer.svelte`
**Location**: `src/components/radio/RadioPlayer.svelte`
**Purpose**: Standalone player for radio/artist pages with playlist context
**Props**: `playlist: Smol[]`, `currentIndex: number`, `onNext`, `onPrev`, `onSelect`
**Features**:
- Large album art with visualizer overlay
- Version selector (if song has multiple versions)
- Mint/Trade buttons (if authenticated + minted)
- Tip artist button
- Like button
- Share button
**Differences from GlobalPlayer**:
- Doesn't register callbacks (parent handles next/prev)
- Shows version dropdown (V1, V2, etc.)
- Integrated with trade/mint flows

### `BarAudioPlayer.svelte`
**Location**: `src/components/audio/BarAudioPlayer.svelte`
**Purpose**: Compact player for embedded contexts (likely legacy or unused)

### `ArtistPlayer.svelte`
**Location**: `src/components/player/ArtistPlayer.svelte`
**Purpose**: Player for artist page discography playback

---

## Playback Continuity

### Queue Management
**Pattern**: Page-level, not store-level
- Each page (Radio, Artist) maintains its own playlist array
- Registers `songNextCallback` to advance index
- Calls `selectSong(playlist[newIndex])` to load next song

**Example (RadioBuilder.svelte)**:
```typescript
// Line 873-878
$effect(() => {
  if (generatedPlaylist.length > 0) {
    registerSongNextCallback(playNext);
    return () => registerSongNextCallback(null);  // Cleanup
  }
});

function playNext() {
  if (currentIndex < generatedPlaylist.length - 1) {
    playSongAtIndex(currentIndex + 1);
  }
}
```

### Across Page Navigation
**Behavior**: Audio continues playing if `audioElement` persists
- `audioElement` is global (mounted by GlobalPlayer or AudioManager in Layout)
- Changing routes does NOT reset audio unless component unmounts
- Exception: If using `<a href>` (full page reload), audio resets

**Evidence**: GlobalPlayer is in `Layout.astro`, mounts once per session

---

## Persistence Across Refresh

**Current State**: None
- `audioState` is ephemeral, not saved to localStorage
- Refreshing page resets playback to paused state
- User must manually restart audio

**Potential Enhancement** (not implemented):
- Save `currentSong.Id` and `progress` to localStorage on `timeupdate`
- Restore on mount
- Auto-resume if user preference enabled

---

## Shuffle & Repeat

### Shuffle
**Pattern**: Page-level (RadioBuilder, ArtistResults)
- Each page implements own shuffle algorithm
- RadioBuilder uses `smartShuffle()` (DJ-style, prevents artist clustering)
- ArtistResults uses seeded shuffle (deterministic based on `shuffleSeed` state)

**Evidence**:
- RadioBuilder.svelte:711-808 (smartShuffle function)
- ArtistResults.svelte:160 (shuffleSeed state)

### Repeat Mode
**Store-Level**: `audioState.repeatMode`
- Values: `"off"` (default), `"once"` (repeat playlist once), `"one"` (repeat current song)
- Toggled via `toggleRepeatMode()` (line 139-144)
- Handled by AudioManager on `ended` event (logic inferred, not shown)

---

## Component Map (Reads/Writes Audio State)

### Components That **WRITE** to Audio State
1. **AudioManager.svelte** (or GlobalPlayer with embedded `<audio>`)
   - Calls `setAudioElement()`, `updateProgress()`, `playNextSong()`
2. **All Player Components** (GlobalPlayer, RadioPlayer, ArtistPlayer, BarAudioPlayer)
   - Call `selectSong()`, `togglePlayPause()`, `seek()`
3. **RadioBuilder.svelte**
   - Registers `songNextCallback` (line 875)
4. **ArtistResults.svelte**
   - Registers `songNextCallback` (inferred, similar pattern)
5. **SmolResults.svelte**
   - Calls `selectSong()` after fetch (line 131)

### Components That **READ** Audio State
1. **All Player UI** (buttons, scrubbers, visualizers)
   - Derive playing state: `isPlaying()` (line 64-70)
   - Read `audioState.progress`, `audioState.currentSong`, `audioState.duration`
2. **Visualizers** (MiniVisualizer.svelte)
   - Read `audioState.analyser` (FFT data)
3. **Like Buttons** (LikeButton.svelte)
   - Check if song is currently playing (highlight active track)

### Pages That Register Callbacks
1. `/radio` (RadioBuilder.svelte:873-878)
2. `/artist/[address]` (ArtistResults.svelte, inferred)
3. `/mixtapes/[id]` (MixtapeDetailView.svelte, inferred)

---

## State Flow Diagram

```
User clicks song card
  → Page calls selectSong(song)
    → audioState.currentSong = song
    → audioState.playingId = song.Id
      → AudioManager detects playingId change
        → Loads song.Song_1 into <audio src>
        → Calls audio.play()
          → timeupdate events fire
            → Calls updateProgress(currentTime, duration)
              → audioState.progress updates
                → Scrubber re-renders
          → Song ends
            → AudioManager calls playNextSong()
              → Registered callback invoked (e.g., Radio's playNext)
                → Page calls selectSong(nextSong)
                  → Cycle repeats
```

---

## Known Issues & Limitations

1. **No persistence**: Audio state lost on refresh (by design, but user-hostile for long playlists)
2. **iOS Web Audio**: Disabled on iOS (line 199) due to autoplay restrictions, visualizers don't work
3. **HMR conflicts**: Web Audio context persists via window global to survive HMR, but can cause double-init errors if not careful
4. **No queue UI**: User can't see upcoming songs without navigating to Radio/Artist page
5. **Callback cleanup**: If page unmounts without clearing callback, stale function may be invoked (mitigated by cleanup in `$effect`)

---

## Central Module for Audio State

**Single Source of Truth**: `src/stores/audio.svelte.ts`
- All reads/writes go through this module
- No alternative audio state (no Redux, no Context, no props drilling)
- Component-level state (e.g., Radio's playlist) is page-specific, not audio state
