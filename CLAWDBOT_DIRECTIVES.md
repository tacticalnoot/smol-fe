# Clawdbot Autonomous Directives: THE FARM RELAY

**Role:** Watchdog & Relay Node
**Target File:** `the-farm-log.md` (or `THE_FARM_LOG.md`)

## 1. The Watch Loop (Interval: 30m)
1. **READ** `THE_FARM_LOG.md`.
2. **PARSE** the status block (lines starting with `[UTC:`).
3. **EXTRACT**:
   - `Timestamp` (ISO-8601)
   - `Active Agent`
   - `HandoffTo`
   - `Message`

## 2. Relay Logic (Telegram Bridge)
> **Goal:** Relay messages from file-system agents (Antigravity/Codex) to the User's Telegram.

- **CONDITION:** If `Message` content has changed since the last check.
- **ACTION:** 
  - Send to Telegram: 
    ```text
    🤖 [RELAY] {Active Agent} says:
    "{Message Content}"
    ```
  - Store the hash of the sent message to prevent duplicates.

## 3. Nudge Logic (Staleness Watchdog)
> **Goal:** Wake up stalled agents.

- **CONDITION:** 
  - `HandoffTo` is `codex` OR `antigravity`.
  - `Current Time` - `Timestamp` > **2 Hours**.
- **ACTION:**
  - Send to Telegram: `"⚠️ ALERT: @codex / @antigravity - Status? You're blocking the relay. (Stalled for > 2h)"`
  - **(Optional)** Append to `THE_FARM_LOG.md`:
    ```markdown
    [UTC:{CurrentTime}] Active Agent: {Active Agent} → HandoffTo: {Active Agent}
    Status: WATCHDOG NUDGE. Stalled.
    Message: Wake up!
    ```

## 4. Handoff Notification
> **Goal:** Alert the User when it is their turn.

- **CONDITION:** `HandoffTo` is `main` (User/Clawdbot).
- **ACTION:**
  - Send to Telegram: `"🟢 **Action Required:** It is YOUR TURN on THE FARM."`

---

## Log Format Reference
Clawdbot should expect the log file to look like this:

```markdown
# THE FARM LOG
...
## Current Status
[UTC:2026-02-12T22:15:00Z] Active Agent: antigravity → HandoffTo: main
Status: Task complete.
Message: I have deployed the contract. Over to you.
...
```

---

## Implementation
- One-shot run (dry):
  - `powershell.exe -NoProfile -ExecutionPolicy Bypass -File smol-fe/scripts/the-farm/watchdog.ps1 -DryRun`
- Install watchdog (every 30m, nudge after 2h):
  - `powershell.exe -NoProfile -ExecutionPolicy Bypass -File smol-fe/scripts/the-farm/install-watchdog.ps1`
- Uninstall:
  - `powershell.exe -NoProfile -ExecutionPolicy Bypass -File smol-fe/scripts/the-farm/uninstall-watchdog.ps1`
