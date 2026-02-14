import type { DoorId, TierParity } from "./policies";
import { getDoorDefinition } from "./policies";

export type Mode = "normal" | "training";

export type ProvenInputs = {
  tierId: number;
};

export type LobbyState =
  | { enabled: false }
  | { enabled: true; waiting: boolean; reason?: string };

export type DoorOutcome = {
  accepted: boolean;
  reasonCode:
    | "ACCEPTED"
    | "PROOF_INVALID"
    | "POLICY_MISMATCH"
    | "LOBBY_WAITING_FOR_OTHER_PLAYER";
  reasonHuman: string;
  forensics: {
    policyName: string;
    policyRule: string;
    doorRequirement: string;
    yourCredentialSummary: string;
    mismatchExplanation: string;
    nextAction: string;
  };
  debug?: {
    tierId: number;
    parity: TierParity;
    comparisons: string[];
  };
};

function parityForTier(tierId: number): TierParity {
  return tierId % 2 === 0 ? "EVEN" : "ODD";
}

export function evaluateDoorAttempt(params: {
  floor: number;
  doorId: DoorId;
  proofOk: boolean;
  provenInputs: ProvenInputs;
  lobbyState: LobbyState;
  mode: Mode;
}): DoorOutcome {
  const door = getDoorDefinition(params.floor, params.doorId);
  const tierId = params.provenInputs.tierId;
  const parity = parityForTier(tierId);

  const comparisons: string[] = [];

  if (!params.proofOk) {
    return {
      accepted: false,
      reasonCode: "PROOF_INVALID",
      reasonHuman: "Credential invalid: proof verification failed.",
      forensics: {
        policyName: door.policyName,
        policyRule: `${door.policyName} (${door.tags.map((t) => t.long).join(", ")})`,
        doorRequirement: door.tags.map((t) => t.long).join(" + "),
        yourCredentialSummary: `Tier ${tierId} (${parity})`,
        mismatchExplanation: "The cryptographic verifier rejected the credential.",
        nextAction: "Regenerate the credential and retry the same door.",
      },
      debug:
        params.mode === "training"
          ? { tierId, parity, comparisons: ["proofOk === false"] }
          : undefined,
    };
  }

  if (params.lobbyState.enabled && params.lobbyState.waiting) {
    return {
      accepted: false,
      reasonCode: "LOBBY_WAITING_FOR_OTHER_PLAYER",
      reasonHuman: "Credential valid, but dual-control requires the other player to reach this gate.",
      forensics: {
        policyName: "Dual-Control Gate",
        policyRule: "Both auditors must be present at the gate",
        doorRequirement: params.lobbyState.reason || "Waiting for the other player",
        yourCredentialSummary: `Tier ${tierId} (${parity})`,
        mismatchExplanation: "This is not a policy mismatch; it is a synchronization gate.",
        nextAction: "Wait for Player 2 to reach the same floor (or switch to Solo).",
      },
      debug:
        params.mode === "training"
          ? { tierId, parity, comparisons: ["lobbyState.waiting === true"] }
          : undefined,
    };
  }

  // Policy evaluation (deterministic and explainable).
  let accepted = false;
  let rule = "";
  let mismatch = "";
  let next = "";

  if (door.policy.kind === "min-tier") {
    const pass = tierId >= door.policy.requiredTierMin;
    comparisons.push(`${tierId} >= ${door.policy.requiredTierMin} => ${pass}`);
    accepted = pass;
    rule = `Minimum Clearance ≥ ${door.policy.requiredTierMin}`;
    mismatch = pass
      ? ""
      : `Door requires Tier ≥ ${door.policy.requiredTierMin}. Your credential proves Tier ${tierId}.`;
    next = pass
      ? "Proceed to the next checkpoint."
      : "Choose a door with MIN ≤ your tier, or increase your clearance tier.";
  } else if (door.policy.kind === "exact-tier") {
    const pass = tierId === door.policy.requiredTierExact;
    comparisons.push(`${tierId} === ${door.policy.requiredTierExact} => ${pass}`);
    accepted = pass;
    rule = `Role = ${door.policy.requiredTierExact}`;
    mismatch = pass
      ? ""
      : `Door requires exactly Tier ${door.policy.requiredTierExact}. Your credential proves Tier ${tierId}.`;
    next = pass
      ? "Proceed to the next checkpoint."
      : "Choose the door whose ROLE matches your tier.";
  } else if (door.policy.kind === "min-tier+parity") {
    const passTier = tierId >= door.policy.requiredTierMin;
    const passParity = parity === door.policy.requiredParity;
    comparisons.push(`${tierId} >= ${door.policy.requiredTierMin} => ${passTier}`);
    comparisons.push(`${parity} === ${door.policy.requiredParity} => ${passParity}`);
    accepted = passTier && passParity;
    rule = `Minimum Clearance ≥ ${door.policy.requiredTierMin} AND Parity = ${door.policy.requiredParity}`;
    mismatch = accepted
      ? ""
      : `Door requires (Tier ≥ ${door.policy.requiredTierMin}) and (Parity = ${door.policy.requiredParity}). Your credential is Tier ${tierId} (${parity}).`;
    next = accepted
      ? "Proceed to the next checkpoint."
      : "Choose a door whose MIN and PARITY both match your credential.";
  } else {
    // Exhaustiveness guard
    const _never: never = door.policy;
    throw new Error(`Unsupported policy kind: ${String(_never)}`);
  }

  if (accepted) {
    return {
      accepted: true,
      reasonCode: "ACCEPTED",
      reasonHuman: "ACCESS GRANTED: credential satisfies this door policy.",
      forensics: {
        policyName: door.policyName,
        policyRule: rule,
        doorRequirement: door.tags.map((t) => t.long).join(" + "),
        yourCredentialSummary: `Tier ${tierId} (${parity})`,
        mismatchExplanation: "None.",
        nextAction: "Proceed to the next floor.",
      },
      debug: params.mode === "training" ? { tierId, parity, comparisons } : undefined,
    };
  }

  return {
    accepted: false,
    reasonCode: "POLICY_MISMATCH",
    reasonHuman: "ACCESS DENIED: credential is valid but does not satisfy this door policy.",
    forensics: {
      policyName: door.policyName,
      policyRule: rule,
      doorRequirement: door.tags.map((t) => t.long).join(" + "),
      yourCredentialSummary: `Tier ${tierId} (${parity})`,
      mismatchExplanation: mismatch,
      nextAction: next,
    },
    debug: params.mode === "training" ? { tierId, parity, comparisons } : undefined,
  };
}

