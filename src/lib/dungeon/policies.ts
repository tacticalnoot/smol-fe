export type DoorId = 0 | 1 | 2 | 3;

export type DoorPolicyTag = {
  short: string; // Small label for the door card UI
  long: string;  // Used in forensic output
};

export type TierParity = "EVEN" | "ODD";

export type DoorPolicy =
  | {
      kind: "min-tier";
      requiredTierMin: number;
    }
  | {
      kind: "exact-tier";
      requiredTierExact: number;
    }
  | {
      kind: "min-tier+parity";
      requiredTierMin: number;
      requiredParity: TierParity;
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

function mkMinTierDoor(id: DoorId, requiredTierMin: number): DoorDefinition {
  return {
    id,
    label: `DOOR ${id + 1}`,
    policyName: "Minimum Clearance",
    policy: { kind: "min-tier", requiredTierMin },
    tags: [
      {
        short: `MIN ≥ ${requiredTierMin}`,
        long: `Minimum Clearance ≥ ${requiredTierMin}`,
      },
    ],
  };
}

function mkExactTierDoor(id: DoorId, requiredTierExact: number): DoorDefinition {
  return {
    id,
    label: `DOOR ${id + 1}`,
    policyName: "Role-Based Access",
    policy: { kind: "exact-tier", requiredTierExact },
    tags: [
      {
        short: `ROLE = ${requiredTierExact}`,
        long: `Role = ${requiredTierExact}`,
      },
    ],
  };
}

function mkMinTierParityDoor(
  id: DoorId,
  requiredTierMin: number,
  requiredParity: TierParity,
): DoorDefinition {
  return {
    id,
    label: `DOOR ${id + 1}`,
    policyName: "Two-Factor Policy",
    policy: { kind: "min-tier+parity", requiredTierMin, requiredParity },
    tags: [
      {
        short: `MIN ≥ ${requiredTierMin}`,
        long: `Minimum Clearance ≥ ${requiredTierMin}`,
      },
      { short: requiredParity, long: `Parity = ${requiredParity}` },
    ],
  };
}

export function getFloorDefinition(floor: number): FloorDefinition {
  if (floor === 1) {
    return {
      floor,
      roomId: "intake",
      policyName: "Minimum Clearance",
      briefing:
        "This wing uses minimum-clearance rules. Read the door tags and choose a policy your credential satisfies.",
      verifierType: "GROTH16",
      doors: [mkMinTierDoor(0, 0), mkMinTierDoor(1, 1), mkMinTierDoor(2, 2), mkMinTierDoor(3, 3)],
    };
  }

  if (floor === 2) {
    return {
      floor,
      roomId: "catalog",
      policyName: "Role-Based Access",
      briefing:
        "This wing is role-gated. Only the exact matching clearance badge opens the door.",
      verifierType: "NOIR_ULTRAHONK",
      doors: [mkExactTierDoor(0, 0), mkExactTierDoor(1, 1), mkExactTierDoor(2, 2), mkExactTierDoor(3, 3)],
    };
  }

  if (floor === 3) {
    return {
      floor,
      roomId: "cold",
      policyName: "Two-Factor Policy",
      briefing:
        "Incident response added a second rule: clearance level plus parity. Your proof can be valid yet still fail policy.",
      verifierType: "RISC0_RECEIPT",
      doors: [
        mkMinTierParityDoor(0, 0, "EVEN"),
        mkMinTierParityDoor(1, 1, "ODD"),
        mkMinTierParityDoor(2, 2, "EVEN"),
        mkMinTierParityDoor(3, 3, "ODD"),
      ],
    };
  }

  throw new Error(`Unsupported floor=${floor}`);
}

export function getDoorDefinition(floor: number, doorId: DoorId): DoorDefinition {
  const def = getFloorDefinition(floor);
  const door = def.doors.find((d) => d.id === doorId);
  if (!door) {
    throw new Error(`Unknown doorId=${doorId} for floor=${floor}`);
  }
  return door;
}
