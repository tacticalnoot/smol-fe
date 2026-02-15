export type DungeonReasonCode =
  | "ACCEPTED"
  | "PROOF_INVALID"
  | "POLICY_MISMATCH"
  | "LOBBY_WAITING_FOR_OTHER_PLAYER"
  | "ERROR";

export type DungeonRoomId = "airlock" | "intake" | "catalog" | "cold" | "ledger";

export type RoomLore = {
  roomId: DungeonRoomId;
  roomTitle: string;
  roomSubtitle: string;
  briefingMarkdown: string; // 2-4 paragraphs, rendered client-side (safe static content)
  protocolPlacard: string; // short memo: exact rule in plain terms
  verifierExplainer: string; // why this verifier exists here
  failureExplainersByReasonCode: Partial<Record<DungeonReasonCode, string>>;
  successExplainer: string;
};

export const dungeonLore: Record<DungeonRoomId, RoomLore> = {
  airlock: {
    roomId: "airlock",
    roomTitle: "Room 0: Airlock",
    roomSubtitle: "Entry Protocol (Mainnet Audit Stamp)",
    briefingMarkdown:
      [
        "The Kale-Seed Vault is not a warehouse. It is an archive of genetic diversity, and the Farm treats it like regulated custody. Every access attempt is a compliance event: someone, at some time, asserted they were authorized to approach sealed material. The system is designed to be useful to auditors without turning the vault into a surveillance tool.",
        "This airlock is the compromise. We stamp entry on-chain as an immutable audit marker, but we do it as a digest-only record. No seed counts, no private inventory values, no room-by-room telemetry. Just enough to prove the run existed and to bind a run identifier to the auditor’s passkey-backed account.",
        "The point is not to make you sign constantly. The point is to make entry undeniable. If a later incident occurs, investigators can prove an access window existed without learning what you saw inside.",
      ].join("\n\n"),
    protocolPlacard:
      "Protocol: Stamp ENTRY on mainnet (digest-only). Then proceed to the proof-gated rooms.",
    verifierExplainer:
      "This is not a proof verification step. It is a Soroban on-chain audit stamp signed with your passkey, using the Farm’s existing relayer flow.",
    failureExplainersByReasonCode: {
      ERROR:
        "Entry stamp failed. This can happen if the relayer is unreachable, the RPC is unhealthy, or the wallet rejects the signature. You can retry, or proceed in demo mode without an on-chain stamp (clearly marked).",
    },
    successExplainer:
      "Entry stamped. Your run now has an immutable on-chain audit marker. Proceed to the vault wings.",
  },

  intake: {
    roomId: "intake",
    roomTitle: "Room 1: Greenhouse Intake Wing",
    roomSubtitle: "Groth Gate (Groth16 / BN254)",
    briefingMarkdown:
      [
        "This wing was built first, after an early mold incident. The policy is blunt and intentionally boring: a minimum clearance is required to handle intake crates. Nobody wanted a complicated rule here because failures in intake are expensive, and auditors need something that can be checked quickly under pressure.",
        "Groth16 is used because it is compact and mature. The verification key is stable, the proof size is small, and verification is a predictable pairing check. In real systems, this is what you deploy when you want long-lived, audit-friendly proof gates that can be verified by constrained environments.",
        "Read the placard, read the door tags, and treat the credential like a clearance badge. A valid proof can still be denied if you choose a door whose policy your credential does not satisfy.",
      ].join("\n\n"),
    protocolPlacard:
      "Policy: Minimum Clearance. Door opens iff your proven tier_id >= the door’s MIN requirement.",
    verifierExplainer:
      "Verifier: Groth16 (Circom / BN254). The dungeon generates a real proof and verifies it locally. If your passkey wallet is connected, this wing also performs real on-chain verification via Tier Verifier (verify_and_attest).",
    failureExplainersByReasonCode: {
      PROOF_INVALID:
        "Credential invalid: the Groth16 verifier rejected the proof. This is not a policy mismatch. Regenerate and retry.",
      POLICY_MISMATCH:
        "Credential valid, but you chose a door whose MIN requirement is above your tier_id. Pick a door with MIN at or below your tier.",
    },
    successExplainer:
      "Intake cleared. Your credential satisfies the minimum-clearance policy. Proceed to catalog custody.",
  },

  catalog: {
    roomId: "catalog",
    roomTitle: "Room 2: Catalog & Custody Hall",
    roomSubtitle: "UltraHonk Arbiter (Noir / bb.js)",
    briefingMarkdown:
      [
        "Catalog custody is where the Farm gets strict. The problem is not mold, it is provenance. A seed drawer is a chain-of-custody object. The wrong role opening the wrong cabinet is a compliance failure even if they are otherwise “high clearance.”",
        "The team that rebuilt this hall standardized on Noir because internal policy proofs changed often. They wanted a pipeline that let them evolve constraints quickly and verify locally with strong performance. UltraHonk is used here as a high-throughput verifier for policy proofs in the “paperwork wing,” where many checks occur and most do not need on-chain settlement.",
        "In the dungeon, Noir verification is cryptographically real. If you are in training mode, the credential may be a verified training artifact rather than a proof generated from your live wallet inputs. The difference is stated plainly in the UI.",
      ].join("\n\n"),
    protocolPlacard:
      "Policy: Role-Based Access. Door opens iff your proven tier_id exactly matches the door’s ROLE requirement.",
    verifierExplainer:
      "Verifier: UltraHonk (Noir). The dungeon can verify locally in the browser, and (when the local prover service is running) it can also submit a real mainnet on-chain verification via farm-attestations → ultrahonk-verifier (VK_ID NOIR_ROLE_V1), signed with your passkey.",
    failureExplainersByReasonCode: {
      PROOF_INVALID:
        "Credential invalid: the UltraHonk verifier rejected the proof artifact. This is a cryptographic failure, not a policy mismatch.",
      POLICY_MISMATCH:
        "Credential valid, but the ROLE does not match your tier_id. In custody, “close enough” is not allowed.",
    },
    successExplainer:
      "Custody cleared. Your credential satisfies role-based access. Proceed to deep freeze storage.",
  },

  cold: {
    roomId: "cold",
    roomTitle: "Room 3: Deep Freeze Cold Storage",
    roomSubtitle: "Receipt Sentinel (RISC0 zkVM)",
    briefingMarkdown:
      [
        "Deep freeze is where logic got complicated. After a power anomaly, the Farm added “two-factor” style policy gates: clearance plus a secondary condition that is cheap to evaluate and easy to audit. They didn’t want to deploy a new on-chain verifier for every revision, and they needed to attest to general checks that could evolve.",
        "zkVM receipts are used here because they can attest to arbitrary computation. The system records that a specific program (identified by a method ID) ran and produced an accepted journal. That’s operationally useful: you can upgrade the policy program, rotate method IDs, and keep a clear audit trail of what was verified.",
        "In this room, the second factor is deterministic and visible: parity. It’s not magical security, it’s a teachable example of multi-constraint policy. Your credential can be valid and still fail the parity requirement.",
      ].join("\n\n"),
    protocolPlacard:
      "Policy: Two-Factor. Door opens iff (tier_id >= MIN) AND (tier_id parity matches EVEN/ODD).",
    verifierExplainer:
      "Verifier: RISC0 receipt verifier (WASM). The dungeon verifies receipts locally, and (when the local prover service is running) it can also submit a real mainnet on-chain Groth16 verification of the receipt via farm-attestations (VK_ID R0G16V1), signed with your passkey.",
    failureExplainersByReasonCode: {
      PROOF_INVALID:
        "Credential invalid: the receipt verifier rejected the artifact. Retry with a valid receipt artifact.",
      POLICY_MISMATCH:
        "Credential valid, but you failed one or both constraints (MIN tier and parity). Read both tags.",
    },
    successExplainer:
      "Cold storage cleared. Your credential satisfies the two-factor policy. Proceed to the ledger chamber.",
  },

  ledger: {
    roomId: "ledger",
    roomTitle: "Room 4: Ledger Chamber",
    roomSubtitle: "Seed Withdrawal Record (Mainnet Audit Stamp)",
    briefingMarkdown:
      [
        "Withdrawal is where stories go wrong in the real world. The vault does not care that you “could have” opened doors. It cares what you actually did, and what policies were satisfied. A completion stamp is the custody record that your run reached the withdrawal threshold.",
        "This record is digest-only. It can be used for audit trails, receipts, and dispute resolution without leaking the private values that your proofs may have depended on. Think of it as a signed compliance memo: room plan, verifier families used, and a run identifier, committed immutably to the ledger.",
        "You will sign at most twice in the standard flow: entry and withdrawal. If you skip stamping, the dungeon remains educational, but it is no longer a reviewer-proof “real mainnet audit stamp” run.",
      ].join("\n\n"),
    protocolPlacard:
      "Protocol: Record WITHDRAWAL on mainnet (digest-only). This is an audit record, not on-chain proof verification.",
    verifierExplainer:
      "This is a passkey-signed Soroban transaction using the repo’s existing relayer flow. It records digests only.",
    failureExplainersByReasonCode: {
      ERROR:
        "Withdrawal record failed. Retry, or end the run without an on-chain completion record (clearly marked).",
    },
    successExplainer:
      "Withdrawal recorded. The ledger now contains a completion stamp for this run.",
  },
};
