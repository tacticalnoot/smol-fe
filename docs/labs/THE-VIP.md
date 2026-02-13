# THE-VIP: Privacy-First Chat Architecture

**"Truly Private" (E2EE) / No Fees / No Extra Steps**

## Updates & Usage

This feature lives at `/labs/the-vip`.
It uses SEP-0010 authentication (Challenge/Response) to establish a session without on-chain transactions.

### How Privacy Works (Threat Model)

1.  **Transport**: All API communication is HTTPS.
2.  **Identity**: Users are identified by their Stellar Public Key.
3.  **End-to-End Encryption (E2EE)**:
    - Each Room has a symmetric **Room Key** (32-byte).
    - Messages are encrypted *client-side* (in browser) using `tweetnacl` (XSalsa20-Poly1305).
    - The server **never** sees plaintext messages. Server DB stores only `ciphertext` and `nonce`.
    - **Key Distribution**:
        - User generates an ephemeral X25519 keypair in browser (IndexedDB).
        - User authenticates (signs challenge).
        - User requests Room Key.
        - Server unwraps the Room Key (from its internal storage) and re-encrypts ("seals") it specifically for the User's X25519 key.
        - User decrypts the Room Key and can now read/write messages.

**Server Knowledge**:
- The Server *temporarily* knows the Room Key during the re-sealing process for a new user.
- The Server Database Admin *could* theoretically decrypt the `room_keys` table if they also have the `CHAT_SERVER_SECRET`.
- **Mitigation**: `CHAT_SERVER_SECRET` should be a guarded environment variable, not stored in the Repo or DB.

### Data Stored on Server (D1)

1.  **`messages`**:
    - `id`: Auto-inc
    - `room_id`: String
    - `sender_hash`: `SHA256(Address + Salt)` (Pseudonymous)
    - `ciphertext`: Base64 string (Encrypted content)
    - `nonce`: Base64 string
    - `created_at`: Timestamp

2.  **`room_keys`**:
    - `room_id`: String
    - `key_material`: Hex string (The room Key) - *Critical Secret*

3.  **`user_keys`**:
    - `address`: Stellar Address
    - `x25519_pubkey`: Hex string (User's ephemeral encryption key)

### Development

**Resetting Keys**:
Run `node scripts/vip/reset-keys.mjs` to clear all room keys. New keys will be generated upon next user join.

**Local Setup**:
Ensure `wrangler.toml` has `d1_databases` binding `DB`.
Wrangler will handle local D1 automatically.
