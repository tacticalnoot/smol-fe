# Task: The Farm gallery polish (2026-02-10)

Context: The /labs/the-farm page still presents the proof modules as a plain text list (“dictionary” look). We need it to feel like a web3 experience that showcases the tech.

Goals
- Replace the flat proof-module list with an interactive card gallery driven by `galleryProofs`.
- Provide a modal/overlay that highlights proof details (inputs, outputs, requirements) with clear CTAs to open proof packets.
- Keep existing proof-generation, game, and verifier flows intact.

Success criteria
- The Farm renders a styled proof gallery (cards + status chips) instead of a text list.
- Clicking a proof opens a modal overlay with the detailed metadata and a close control.
- Checks run without introducing new errors (acknowledge any pre-existing warnings if they surface).

Next steps (Stellar ZK Dungeon plan, lightweight TODO)
1) Clone game studio per quickstart (WSL recommended), then `bun run setup` and `bun run create the-farm`.
2) Build Noir circuit “door_proof”: commit binding, choice<4, expected=(secret+floor+nonce)%4, output is_correct bit (no assert).
3) Write verifier contract + main game contract: lobby, commits, attempt_door, start/end hub calls (CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG), gates on floors 1 & 5.
4) Frontend: fullscreen Three.js room with 4 rune pedestals, worker-based proving, proof/tx overlay, two-player lobby + opponent progress beacon, co-op gate UX.
5) Tests/acceptance: wrong-proof still valid (is_correct=0), nonce monotonic, hub start/end observable, perf stays smooth while proving.
