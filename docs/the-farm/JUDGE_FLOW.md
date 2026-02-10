# The Farm — ZK Dungeon: 60-Second Judge Flow

*Last updated: 2026-02-10*

## The Path (Judge Can't Miss It)

### Step 1: Land (5 seconds)
- Visit the deployed smol-fe site
- Navigate to **Labs** → **The Farm** → **ZK Dungeon**
- Or go directly to `/labs/the-farm/play`

### Step 2: Connect (10 seconds)
- Click **"Start with Passkey"** (recommended, zero-friction)
- Or click **"Other Wallets"** to use Stellar Wallets Kit
- Testnet account auto-funded via friendbot if needed

### Step 3: Create or Join Lobby (10 seconds)
- Click **"Create Lobby"** → get a 6-character lobby code
- Share code with Player 2 (or open a second browser tab)
- Player 2 enters code → clicks **"Join"**
- Both players set their sigil commitment → game starts
- `start_game()` called on hub contract (visible in run log)

### Step 4: Play the Dungeon (25 seconds)
- 10 floors, each with 4 doors
- Pick a door → see **"Computing proof..."** overlay
- ZK proof generated in WebWorker → signed → submitted on-chain
- Door animates: **correct** (door opens, green glow) or **wrong** (trap, red flash)
- Run log updates: floor #, attempt #, proof type, tx hash link, is_correct
- Floors 1 & 5: co-op gate — both players must clear before advancing

### Step 5: Win or Observe (10 seconds)
- Reach floor 10 → boss encounter (RISC Zero proof)
- `end_game()` called on hub contract
- Victory screen with full run summary
- Link to **On-Chain Evidence Dashboard** (`/labs/the-farm/run/:lobbyId`)

## What the Judge Sees (Evidence)

| Signal | Where |
|--------|-------|
| Real ZK proofs (Noir) on every door attempt | Run log + tx hash links |
| Wrong choices still verify (is_correct=0) | Run log shows red "WRONG" with valid tx |
| Circom floor (at least 1) | Run log shows "Circom Gate" proof type |
| RISC Zero boss floor | Run log shows "RISC Zero Boss Gate" |
| start_game() hub call | Run log first entry + dashboard |
| end_game() hub call | Run log final entry + dashboard |
| Two-player co-op gates | Floors 1 & 5 wait state visible |
| On-chain evidence dashboard | `/labs/the-farm/run/:lobbyId` with full timeline |
| Passkey smart account | Zero-friction wallet setup |

## Fallback: Solo Mode

If judge is alone:
- Create lobby → play solo (co-op gates auto-clear after timeout or single-player mode toggle)
- All proofs and transactions still work identically
- Dashboard still shows full evidence

## Key URLs

| Page | Route |
|------|-------|
| Game Launcher | `/labs/the-farm/play` |
| ZK Dungeon Portal | `/labs/the-farm/zkdungeon` |
| The Farm Dashboard | `/labs/the-farm` |
| Evidence Dashboard | `/labs/the-farm/run/:lobbyId` |
| Hub Contract | `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG` |
