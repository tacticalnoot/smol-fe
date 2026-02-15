export type DoorId = 0 | 1 | 2 | 3;

export type DoorPolicyTag = {
  short: string; // Small label for the door card UI
  long: string;  // Used in forensic output
};

export type TierParity = "EVEN" | "ODD";

export type VaultLaneCode = 0 | 1 | 2 | 3;
export type VaultLaneName = "INDIGO" | "AMBER" | "MINT" | "ROSE";

export type VaultLane = {
  code: VaultLaneCode;
  name: VaultLaneName;
  color: string;
};

export type DoorPolicy =
  | {
      kind: "min-tier+lane";
      requiredTierMin: number;
      requiredLane: VaultLaneCode;
    }
  | {
      kind: "exact-tier+lane";
      requiredTierExact: number;
      requiredLane: VaultLaneCode;
    }
  | {
      kind: "min-tier+parity+lane";
      requiredTierMin: number;
      requiredParity: TierParity;
      requiredLane: VaultLaneCode;
    };

export type DoorDefinition = {
  id: DoorId;
  label: string;
  policyName: string;
  policy: DoorPolicy;
  tags: DoorPolicyTag[];
};

export type FloorDefinition = {
  floor: number;
  roomId: "intake" | "catalog" | "cold";
  policyName: string;
  briefing: string;
  verifierType: "GROTH16" | "NOIR_ULTRAHONK" | "RISC0_RECEIPT";
  doors: DoorDefinition[];
};

function parityForTier(tierId: number): TierParity {
  return tierId % 2 === 0 ? "EVEN" : "ODD";
}

export function tierLabel(tierId: number): string {
  // Keep short, readable labels (and avoid "0" being the obvious answer).
  switch (tierId) {
    case 0:
      return "SPROUT";
    case 1:
      return "GROWER";
    case 2:
      return "HARVEST";
    case 3:
      return "WHALE";
    default:
      return `TIER ${tierId}`;
  }
}

export function vaultLaneFromCode(code: VaultLaneCode): VaultLane {
  switch (code) {
    case 0:
      return { code, name: "INDIGO", color: "#4ad0ff" };
    case 1:
      return { code, name: "AMBER", color: "#ffc47a" };
    case 2:
      return { code, name: "MINT", color: "#7bffb0" };
    case 3:
      return { code, name: "ROSE", color: "#ff7bbd" };
  }
}

function fnv1a32(input: string): number {
  // Deterministic, fast hash for policy generation (no async crypto).
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function laneCodeForSeed(seed: string, floor: number): VaultLaneCode {
  const n = fnv1a32(`${seed}:lane:${floor}`) % 4;
  return n as VaultLaneCode;
}

function shuffledDoorIds(seed: string): DoorId[] {
  const prng = mulberry32(fnv1a32(seed));
  const ids: DoorId[] = [0, 1, 2, 3];
  for (let i = ids.length - 1; i > 0; i -= 1) {
    const j = Math.floor(prng() * (i + 1));
    const tmp = ids[i];
    ids[i] = ids[j];
    ids[j] = tmp;
  }
  return ids;
}

function mkMinTierLaneDoor(
  id: DoorId,
  requiredTierMin: number,
  requiredLane: VaultLaneCode,
): DoorDefinition {
  const lane = vaultLaneFromCode(requiredLane);
  return {
    id,
    label: `DOOR ${id + 1}`,
    policyName: "Intake Routing",
    policy: { kind: "min-tier+lane", requiredTierMin, requiredLane },
    tags: [
      {
        short: `MIN ≥ ${tierLabel(requiredTierMin)}`,
        long: `Minimum Clearance ≥ ${tierLabel(requiredTierMin)} (${requiredTierMin})`,
      },
      { short: `LANE: ${lane.name}`, long: `Routing Lane = ${lane.name}` },
    ],
  };
}

function mkExactTierLaneDoor(
  id: DoorId,
  requiredTierExact: number,
  requiredLane: VaultLaneCode,
): DoorDefinition {
  const lane = vaultLaneFromCode(requiredLane);
  return {
    id,
    label: `DOOR ${id + 1}`,
    policyName: "Role-Based Access",
    policy: { kind: "exact-tier+lane", requiredTierExact, requiredLane },
    tags: [
      {
        short: `ROLE = ${tierLabel(requiredTierExact)}`,
        long: `Role = ${tierLabel(requiredTierExact)} (${requiredTierExact})`,
      },
      { short: `LANE: ${lane.name}`, long: `Custody Lane = ${lane.name}` },
    ],
  };
}

function mkMinTierParityLaneDoor(
  id: DoorId,
  requiredTierMin: number,
  requiredParity: TierParity,
  requiredLane: VaultLaneCode,
): DoorDefinition {
  const lane = vaultLaneFromCode(requiredLane);
  return {
    id,
    label: `DOOR ${id + 1}`,
    policyName: "Two-Factor Policy",
    policy: { kind: "min-tier+parity+lane", requiredTierMin, requiredParity, requiredLane },
    tags: [
      {
        short: `MIN ≥ ${tierLabel(requiredTierMin)}`,
        long: `Minimum Clearance ≥ ${tierLabel(requiredTierMin)} (${requiredTierMin})`,
      },
      { short: requiredParity, long: `Parity = ${requiredParity}` },
      { short: `LANE: ${lane.name}`, long: `Cold-Chain Lane = ${lane.name}` },
    ],
  };
}

export function getFloorDefinition(
  floor: number,
  ctx: { seed: string; tierId: number },
): FloorDefinition {
  const lane = laneCodeForSeed(ctx.seed || "demo", floor);
  const tierId = Math.max(0, Math.min(3, Math.trunc(ctx.tierId)));
  const tierParity = parityForTier(tierId);
  const prng = mulberry32(fnv1a32(`${ctx.seed}:floor:${floor}`));

  // Pick which physical doors share the current lane (one is correct, one is a decoy).
  const [correctDoor, decoyDoor, wrong1, wrong2] = shuffledDoorIds(`${ctx.seed}:doors:${floor}`);
  const otherLanes: VaultLaneCode[] = ([0, 1, 2, 3].filter((c) => c !== lane) as VaultLaneCode[]);
  const wrongLane1 = otherLanes[0] ?? ((lane + 1) % 4 as VaultLaneCode);
  const wrongLane2 = otherLanes[1] ?? ((lane + 2) % 4 as VaultLaneCode);

  const doorsById = new Map<DoorId, DoorDefinition>();

  if (floor === 1) {
    // Intake: clearance bar is low, but routing lanes prevent cross-contamination.
    // Correct door: lane match + min <= tier (always satisfiable).
    // Decoy: lane match but min too high (teaches min vs lane).
    const minOk = Math.max(0, tierId - (prng() > 0.6 ? 1 : 0));
    const minTooHigh = Math.min(3, tierId + 1);

    doorsById.set(correctDoor, mkMinTierLaneDoor(correctDoor, minOk, lane));
    doorsById.set(decoyDoor, mkMinTierLaneDoor(decoyDoor, minTooHigh, lane));
    doorsById.set(wrong1, mkMinTierLaneDoor(wrong1, Math.max(0, tierId - 1), wrongLane1));
    doorsById.set(wrong2, mkMinTierLaneDoor(wrong2, Math.min(3, tierId + 2), wrongLane2));

    return {
      floor,
      roomId: "intake",
      policyName: "Intake Routing",
      briefing:
        "Intake uses two constraints: a minimum clearance plus a routing lane. Read both tags; a valid credential can still be denied by lane mismatch.",
      verifierType: "GROTH16",
      doors: [0, 1, 2, 3].map((id) => doorsById.get(id as DoorId)!) as DoorDefinition[],
    };
  }

  if (floor === 2) {
    // Catalog: exact role + lane.
    // Correct: exact tier + lane. Decoy: lane match, wrong tier.
    const wrongTier = (tierId + 1) % 4;
    doorsById.set(correctDoor, mkExactTierLaneDoor(correctDoor, tierId, lane));
    doorsById.set(decoyDoor, mkExactTierLaneDoor(decoyDoor, wrongTier, lane));
    doorsById.set(wrong1, mkExactTierLaneDoor(wrong1, tierId, wrongLane1));
    doorsById.set(wrong2, mkExactTierLaneDoor(wrong2, (tierId + 2) % 4, wrongLane2));

    return {
      floor,
      roomId: "catalog",
      policyName: "Role-Based Access",
      briefing:
        "Custody is strict: exact role plus custody lane. Read both tags; “close enough” does not open drawers.",
      verifierType: "NOIR_ULTRAHONK",
      doors: [0, 1, 2, 3].map((id) => doorsById.get(id as DoorId)!) as DoorDefinition[],
    };
  }

  if (floor === 3) {
    // Cold storage: multi-constraint (min + parity + lane).
    // Correct: tier ok + parity ok + lane ok. Decoy: lane ok but parity flipped.
    const minOk = Math.max(0, tierId - (prng() > 0.5 ? 1 : 0));
    const minTooHigh = Math.min(3, tierId + 1);
    const flippedParity: TierParity = tierParity === "EVEN" ? "ODD" : "EVEN";

    doorsById.set(correctDoor, mkMinTierParityLaneDoor(correctDoor, minOk, tierParity, lane));
    doorsById.set(decoyDoor, mkMinTierParityLaneDoor(decoyDoor, minOk, flippedParity, lane));
    doorsById.set(wrong1, mkMinTierParityLaneDoor(wrong1, minTooHigh, tierParity, wrongLane1));
    doorsById.set(wrong2, mkMinTierParityLaneDoor(wrong2, minOk, flippedParity, wrongLane2));

    return {
      floor,
      roomId: "cold",
      policyName: "Two-Factor Policy",
      briefing:
        "Incident response added two-factor: minimum clearance + parity + cold-chain lane. A credential can be valid and still fail policy.",
      verifierType: "RISC0_RECEIPT",
      doors: [0, 1, 2, 3].map((id) => doorsById.get(id as DoorId)!) as DoorDefinition[],
    };
  }

  throw new Error(`Unsupported floor=${floor}`);
}

export function getDoorDefinition(
  floor: number,
  doorId: DoorId,
  ctx: { seed: string; tierId: number },
): DoorDefinition {
  const def = getFloorDefinition(floor, ctx);
  const door = def.doors.find((d) => d.id === doorId);
  if (!door) {
    throw new Error(`Unknown doorId=${doorId} for floor=${floor}`);
  }
  return door;
}
