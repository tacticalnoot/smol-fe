# Google Cast Debugging Guide

This document explains how to debug Google Cast (Chromecast) issues on mobile and desktop.

## Quick Start

### Enable Debug Mode

1. **In Browser Console:**
   ```javascript
   localStorage.setItem("CAST_DEBUG", "true")
   ```
   Then reload the page.

2. **Or add to `.env`:**
   ```
   PUBLIC_CAST_DEBUG=true
   ```

### Using Cast Diagnostics Panel

For development, you can add the Cast Diagnostics panel to any page:

```svelte
<script>
    import CastDiagnostics from "../components/dev/CastDiagnostics.svelte";
</script>

{#if import.meta.env.DEV}
    <CastDiagnostics />
{/if}
```

The panel provides:
- **Run Diagnostics**: Tests the audio URL for Chromecast compatibility
- **Print Cast State**: Logs current Cast state to console
- **Toggle Debug Mode**: Enable/disable verbose logging

## What Gets Logged

With `CAST_DEBUG` enabled, you'll see detailed logs for:

### Session Events
- Session state changes (STARTED, RESUMED, ENDED)
- Connection state changes
- Session errors

### Media Loading
- Full LoadRequest payload (contentId, contentType, streamType, metadata)
- Load success/failure
- Error codes with contentId details

### Player State
- Player state changes (IDLE, BUFFERING, PLAYING, PAUSED)
- Idle reasons (ERROR, CANCELLED, FINISHED)
- Playback progress (current time / duration)
- Pause/resume events

## Diagnosing Common Issues

### Issue: "Artwork flashes then blue Cast logo"

This means the receiver loaded but **media failed to load**.

**Run diagnostics:**
```javascript
// In console after loading Cast SDK
await castService.diagnoseMediaUrl("YOUR_AUDIO_URL");
```

**Check for:**
1. ✅ HEAD returns 200 with correct `Content-Type: audio/mpeg`
2. ✅ Range request returns **206 Partial Content** (not 200)
3. ✅ `Accept-Ranges: bytes` header present
4. ✅ `Content-Range` header in 206 response

**Common fixes:**
- Audio proxy must support Range requests (return 206)
- Must include `Accept-Ranges: bytes` header
- Must include proper CORS headers (`Access-Control-Allow-Origin: *`)
- URL must be HTTPS (except localhost)

### Issue: No audio plays

**Check:**
1. Is `streamType` set to `BUFFERED`?
   - Look for: `[Cast] Load request: { streamType: "BUFFERED" }`
2. Is `contentType` correct (`audio/mpeg`)?
3. Check player state transitions in console

### Issue: Cast button doesn't work

**Check:**
1. Is Cast SDK loaded? Look for: `[Cast] SDK available: true`
2. Is Cast initialized? Look for: `[Cast] Initialized with CastContext`
3. Are you on HTTPS or localhost?

## Architecture Notes

### Audio URL Flow
```
User plays song
    ↓
castService.loadMedia(song)
    ↓
contentId = ${window.location.origin}/api/audio/${songId}
    ↓
Chromecast fetches from /api/audio/[id]
    ↓
Proxy forwards to api.smol.xyz/song/${id}.mp3
```

### Critical Headers (Chromecast Requirements)

**Audio Proxy Must Return:**
- `Content-Type: audio/mpeg`
- `Accept-Ranges: bytes`
- `Access-Control-Allow-Origin: *`
- For Range requests: `206 Partial Content` + `Content-Range: bytes x-y/total`

### MediaInfo Requirements

```typescript
const mediaInfo = new chrome.cast.media.MediaInfo(audioUrl, "audio/mpeg");
mediaInfo.streamType = cast.framework.messages.StreamType.BUFFERED; // CRITICAL!

const request = new chrome.cast.media.LoadRequest(mediaInfo);
request.autoplay = true;
request.currentTime = 0;
```

## Testing on Android

1. Ensure Android device and Chromecast are on same Wi-Fi
2. Open site in Chrome (not other browsers)
3. Enable `CAST_DEBUG` via console
4. Tap Cast button and select device
5. Play a song
6. Check console for errors

**Pass criteria:**
- Receiver shows artwork continuously
- Audio plays
- Progress updates in console

**Fail criteria:**
- Artwork flashes then blue logo
- Player state goes IDLE with reason ERROR
- No audio

## Files Modified for Cast Fixes

- `/src/services/cast.ts` - Enhanced diagnostics, strict LoadRequest
- `/src/pages/api/audio/[id].ts` - Added Range support, HEAD support
- `/src/components/dev/CastDiagnostics.svelte` - Dev diagnostics panel

## References

- [Cast Web Sender API](https://developers.google.com/cast/docs/web_sender)
- [Media Track Metadata](https://developers.google.com/cast/docs/reference/web_sender/chrome.cast.media.MusicTrackMediaMetadata)
- [HTTP Range Requests (RFC 7233)](https://httpwg.org/specs/rfc7233.html)
