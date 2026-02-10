# The Farm — ZK Dungeon: 60-Second Judge Flow

*Last updated: 2026-02-10*

## The Path

### Step 1: Land (5 seconds)
- Visit the deployed site
- Navigate to **Labs** → **The Farm** → **ZK Dungeon**
- Direct link: `/labs/the-farm/dungeon-room`

### Step 2: Connect (10 seconds)
- Click **"Connect Wallet"** — passkey smart account, zero friction
- Testnet account auto-funded via friendbot if needed

### Step 3: Create Lobby (10 seconds)
- Click **"Create Lobby"** → get a 6-character lobby code
- Share code with Player 2, or start solo
- `start_game()` registered on hub contract (visible in run log)

### Step 4: Play the Dungeon (25 seconds)
- 10 floors, each with 4 rune-sealed doors
- Pick a door → real Groth16 ZK proof generated in browser
- Door animates: **correct** (opens, green glow) or **wrong** (sealed, red flash)
- Run log updates: floor, door, proof type, proving time, ZK verified badge, tx link
- Floors 1 & 5: co-op gate — both players must clear before advancing

### Step 5: Victory (10 seconds)
- Clear floor 10 → `end_game()` finalized on hub contract
- Victory screen: stats (floors, attempts, on-chain txs), proof types used, hub tx links

## What the Judge Sees

| Signal | Where |
|--------|-------|
| Real Groth16 proofs on every door | Run log with ZK badge + proving time |
| Wrong choices still verify | Run log shows "SEALED" with valid proof |
| Circom floors (3 & 7) | Run log shows "Circom" proof type |
| Hub contract lifecycle | Game Start / Game End entries with tx links |
| Two-player co-op gates | Floors 1 & 5 synchronization overlay |
| Passkey smart account | Zero-friction wallet, one tap |

## Solo Mode

If judge is alone:
- Create lobby → start solo (co-op gates auto-clear after brief delay)
- All proofs and transactions work identically

## Key URLs

| Page | Route |
|------|-------|
| ZK Dungeon (game) | `/labs/the-farm/dungeon-room` |
| The Farm Dashboard | `/labs/the-farm` |
| Hub Contract | `CB4VZAT2U3UC6XFK3N23SKRF2NDCMP3QHJYMCHHFMZO7MRQO6DQ2EMYG` |
