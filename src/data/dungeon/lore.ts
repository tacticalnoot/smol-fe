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
        "The Kale-Seed Vault holds decades of irreplaceable crop genetics. When a vial goes missing inside an unlogged access window, it stays missing — and without an audit trail, the investigation has nowhere to start. The Farm’s answer was not cameras or constant sign-offs. It was a single, signed commitment at the door.",
        "This airlock stamps your entry as a digest-only record on mainnet: a cryptographic note that *someone, holding this passkey, entered this vault at this moment.* No seed inventory. No room-by-room telemetry. Just enough to bind a run ID to your account before the inner doors open.",
        "Stamping is optional. Skip it and proceed in demo mode — the proof rooms still work. But if something goes wrong inside, the audit trail stops right here.",
      ].join("\n\n"),
    protocolPlacard:
      "Protocol: Stamp ENTRY on mainnet (digest-only). Then proceed to the proof-gated rooms.",
    verifierExplainer:
      "This is not a proof verification step. It is a Soroban on-chain audit stamp signed with your passkey, using the Farm’s existing relayer flow.",
    failureExplainersByReasonCode: {
      ERROR:
        "Entry stamp failed. This can happen if the relayer is unreachable, the RPC is unhealthy, or the wallet rejects the signature. You can retry, or proceed without an on-chain stamp — the proof rooms still work either way.",
    },
    successExplainer:
      "Entry stamped. The ledger now knows this run started. Proceed to the vault wings.",
  },

  intake: {
    roomId: "intake",
    roomTitle: "Room 1: Greenhouse Intake Wing",
    roomSubtitle: "Groth Gate (Groth16 / BN254)",
    briefingMarkdown:
      [
        "This wing was built in a hurry, after a mold outbreak traced back to unqualified handling at intake. The post-mortem found that anyone with a building badge could move crates — no minimum clearance, no lane routing. That gap closed overnight, and the rule has not changed since: minimum tier, correct lane, no exceptions.",
        "The team chose Groth16 because the audit committee wanted something that would still be readable in ten years. The verification key is stable, the proof fits in a text field, and the pairing check runs in milliseconds. When failures are expensive and pressure is high, you want a gate that is boring to operate.",
        "Each door shows two tags. Both must match your credential. A cryptographically valid proof is still rejected if it is presented at the wrong door — the proof system does not know which door you chose; the policy layer does.",
      ].join("\n\n"),
    protocolPlacard:
      "Policy: Intake Routing. Door opens iff (tier_id >= MIN) AND (Lane matches). Read both tags.",
    verifierExplainer:
      "Verifier: Groth16 (Circom / BN254). The dungeon generates a real proof and verifies it locally. If your passkey wallet is connected, this wing submits the proof to a custom-built Tier Verifier contract on Stellar Mainnet — written from scratch to accept Groth16 proofs and run BN254 pairing checks via CAP-0074 host functions. Not a template, not an audit tool wrapper. A purpose-built on-chain verifier for this exact credential scheme.",
    failureExplainersByReasonCode: {
      PROOF_INVALID:
        "Credential invalid: the Groth16 verifier rejected the proof. This is a cryptographic failure, not a policy mismatch. Regenerate and retry.",
      POLICY_MISMATCH:
        "Credential valid, but the MIN or LANE on this door does not match your credential. The proof was correct — you just picked the wrong door. Check both tags.",
    },
    successExplainer:
      "Intake cleared. Minimum clearance confirmed, lane matched. Proceed to catalog custody.",
  },

  catalog: {
    roomId: “catalog”,
    roomTitle: “Room 2: Catalog & Custody Hall”,
    roomSubtitle: “UltraHonk Arbiter (Noir / bb.js)”,
    briefingMarkdown:
      [
        “The intake wing keeps out the unqualified. This wing keeps out the merely qualified. A seed drawer is a chain-of-custody object — the wrong role opening the right cabinet is a compliance event, even for senior staff. Clearance level is not the same as authorization.”,
        “After a provenance audit flagged three unmarked cabinet accesses, the custody team rebuilt this hall's policy engine in Noir. They needed to revise constraints frequently — new cultivar classifications, rotating lane assignments — without redeploying verification infrastructure for each change. The solution was a custom-built UltraHonk verifier contract, written from scratch and deployed to Stellar Mainnet. No pre-existing Noir verifier existed on Soroban; this is one of the first. UltraHonk verification runs fast enough locally for high-throughput checks, and the same proof can be settled on-chain with a passkey signature when a permanent record is needed.”,
        “The rule here is exact match, not minimum clearance. Your tier must equal the role on the door — not exceed it, not approximate it. The catalog's least favorite phrase is 'close enough.'”,
      ].join(“\n\n”),
    protocolPlacard:
      “Policy: Role-Based + Custody Lane. Door opens iff (tier_id matches ROLE exactly) AND (Lane matches).”,
    verifierExplainer:
      “Verifier: UltraHonk (Noir). Local verification runs in-browser via bb.js. On-chain verification uses a custom-built UltraHonk verifier contract, written from scratch and deployed to Stellar Mainnet — one of the first Noir proof verifiers ever live on Soroban. No off-the-shelf solution existed; the contract was purpose-built for this system. When the local prover is running, this room submits a real on-chain UltraHonk verification via farm-attestations → ultrahonk-verifier (VK_ID NOIR_ROLE_V1), signed with your passkey and settled on the Stellar ledger.”,
    failureExplainersByReasonCode: {
      PROOF_INVALID:
        “Credential invalid: the UltraHonk verifier rejected the proof artifact. This is a cryptographic failure, not a policy mismatch. Retry with a fresh credential.”,
      POLICY_MISMATCH:
        “Credential valid, but the ROLE or LANE does not match. Exact tier required — being over-qualified is still a mismatch here. Check both tags.”,
    },
    successExplainer:
      “Custody cleared. Role confirmed, lane matched. Proceed to deep freeze storage.”,
  },

  cold: {
    roomId: “cold”,
    roomTitle: “Room 3: Deep Freeze Cold Storage”,
    roomSubtitle: “Receipt Sentinel (RISC0 zkVM)”,
    briefingMarkdown:
      [
        “After a power anomaly knocked out one cold-chain corridor for six hours, the Farm got paranoid. The original policy — tier only — had left a gap: a single compromised credential could cause a cold-chain break with no secondary check. The team added a second constraint layer. Not biometrics, not a second passkey. Something cheaper and more auditable.”,
        “They chose parity — EVEN or ODD based on your tier ID. It is not sophisticated. That is the point. The RISC0 zkVM handles it because zkVM receipts can attest to arbitrary computation, which means the policy program can be upgraded without touching the verifier contract. What makes this room remarkable: a custom Soroban contract wraps the RISC0 receipt in a Groth16 proof and verifies it on Stellar Mainnet using native BN254 pairing — the same CAP-0074 host function used in Room 1, now repurposed to settle zkVM receipts on-chain. Arbitrary computation, verified on Stellar.”,
        “Three tags now. Minimum tier, parity, lane — all three must match. A credential that passes the first two and fails the lane is still a rejection. Cold storage does not have an appeal process.”,
      ].join(“\n\n”),
    protocolPlacard:
      “Policy: Two-Factor + Cold-Chain Lane. Door opens iff (tier_id >= MIN) AND (parity matches) AND (Lane matches).”,
    verifierExplainer:
      “Verifier: RISC0 zkVM (WASM). Local verification checks the receipt directly in-browser. On-chain verification goes further: RISC0 wraps its receipt in a Groth16 proof, and a custom-built Soroban contract — written from scratch — verifies that proof on Stellar Mainnet using BN254 pairing via CAP-0074. Same primitive as Room 1's Circom gate, entirely new contract, entirely new use case: settling arbitrary zkVM computation on Stellar. When the local prover is running, this room submits that real on-chain verification via farm-attestations (VK_ID R0G16V1), signed with your passkey.”,
    failureExplainersByReasonCode: {
      PROOF_INVALID:
        “Credential invalid: the receipt verifier rejected the artifact. This is a cryptographic failure. Retry with a fresh credential.”,
      POLICY_MISMATCH:
        “Credential valid, but you failed at least one constraint (MIN tier, parity, or lane). All three must match — check each tag.”,
    },
    successExplainer:
      “Cold storage cleared. All three constraints satisfied. Proceed to the ledger chamber.”,
  },

  ledger: {
    roomId: “ledger”,
    roomTitle: “Room 4: Ledger Chamber”,
    roomSubtitle: “Seed Withdrawal Record (Mainnet Audit Stamp)”,
    briefingMarkdown:
      [
        “You made it through. Three policy gates, three proof systems, all cleared. The ledger chamber is where that fact becomes a permanent record.”,
        “The completion stamp is digest-only: room plan, verifier families used, run ID — no private values, no proof contents. Think of it as a signed compliance memo. In a real dispute, this is the record that matters most. Not the individual door proofs, but the completion event: the vault was entered, all gates were satisfied, and the run ended cleanly.”,
        “Stamp it or don’t. Either way, the inner vault is behind you. But if this run counted — for an audit, a hackathon, a demo — sign it. The ledger does not accept verbal confirmation.”,
      ].join(“\n\n”),
    protocolPlacard:
      “Protocol: Record WITHDRAWAL on mainnet (digest-only). This is an audit record, not on-chain proof verification.”,
    verifierExplainer:
      “This is a passkey-signed Soroban transaction using the repo’s existing relayer flow. It records digests only.”,
    failureExplainersByReasonCode: {
      ERROR:
        “Withdrawal record failed. Retry, or end the run without an on-chain completion record — the dungeon run is still valid either way.”,
    },
    successExplainer:
      “Withdrawal recorded. The ledger now has a completion stamp for this run. You’re done.”,
  },
};
