// Sample proofs for THE FARM demo/testing.
// These are synthetic — never treated as real on-chain proofs.
// Uses the repo's actual Groth16Proof / ProofResult / ProofPacket shapes
// from src/components/labs/the-farm/zkTypes.ts.

import type { Groth16Proof, ProofResult, ProofPacket } from "../components/labs/the-farm/zkTypes";
import { TIER_CONFIG } from "../components/labs/the-farm/zkTypes";

export interface FarmSampleProof {
    id: string;
    label: string;
    tier: string;
    tierIndex: number;
    description: string;
    proofPacket: ProofPacket;
    proofResult: ProofResult;
    isValid: boolean;
    isEdgeCase?: boolean;
    _demo: true;
}

function makeSyntheticGroth16(seed: number): Groth16Proof {
    const hex = (n: number) =>
        BigInt(n * 0x1234567890abcdef + seed * 0xdeadbeef).toString(16).padStart(64, "0");
    return {
        pi_a: [hex(1), hex(2), "1"],
        pi_b: [
            [hex(3), hex(4)],
            [hex(5), hex(6)],
            ["1", "0"],
        ],
        pi_c: [hex(7), hex(8), "1"],
        protocol: "groth16",
        curve: "bn254",
    };
}

function makeSyntheticResult(seed: number, tierId: number): ProofResult {
    const commitment = BigInt(seed * 0xabcdef1234567 + tierId * 0x999).toString(16).padStart(64, "0");
    return {
        proof: makeSyntheticGroth16(seed),
        publicSignals: [
            String(tierId),
            "0x" + commitment,
            BigInt(seed * 7919).toString(),
        ],
    };
}

function makeSyntheticPacket(seed: number, tierId: number): ProofPacket {
    const addr = "G" + "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567".slice(0, 10).repeat(5).slice(0, 55);
    return {
        farmer: addr,
        tier: tierId,
        commitment: "0x" + BigInt(seed * 0xabcdef1234567 + tierId * 0x999).toString(16).padStart(64, "0"),
        salt: "0x" + BigInt(seed * 31337).toString(16).padStart(64, "0"),
    };
}

export const FARM_SAMPLE_PROOFS: FarmSampleProof[] = [
    {
        id: "demo-sprout-basic",
        label: "Basic Sprout",
        tier: TIER_CONFIG[0].name,
        tierIndex: 0,
        description: "Happy path, minimal proof — lowest tier with valid Groth16 payload.",
        proofPacket: makeSyntheticPacket(1001, 0),
        proofResult: makeSyntheticResult(1001, 0),
        isValid: true,
        _demo: true,
    },
    {
        id: "demo-grower-active",
        label: "Active Grower",
        tier: TIER_CONFIG[1].name,
        tierIndex: 1,
        description: "Mid-tier proof representing a typical active farmer (100+ KALE).",
        proofPacket: makeSyntheticPacket(2002, 1),
        proofResult: makeSyntheticResult(2002, 1),
        isValid: true,
        _demo: true,
    },
    {
        id: "demo-harvester-full",
        label: "Full Harvester",
        tier: TIER_CONFIG[2].name,
        tierIndex: 2,
        description: "High-tier proof with all standard fields populated (1,000+ KALE).",
        proofPacket: makeSyntheticPacket(3003, 2),
        proofResult: makeSyntheticResult(3003, 2),
        isValid: true,
        _demo: true,
    },
    {
        id: "demo-whale-max",
        label: "Whale Proof",
        tier: TIER_CONFIG[3].name,
        tierIndex: 3,
        description: "Max-tier proof with all optional fields present (10,000+ KALE).",
        proofPacket: makeSyntheticPacket(4004, 3),
        proofResult: makeSyntheticResult(4004, 3),
        isValid: true,
        _demo: true,
    },
    {
        id: "demo-corrupted",
        label: "Corrupted Proof",
        tier: TIER_CONFIG[0].name,
        tierIndex: 0,
        description: "Malformed data — tests error handling UI.",
        proofPacket: {
            farmer: "GINVALID",
            tier: -1,
            commitment: "0xBAD",
            salt: "",
        },
        proofResult: {
            proof: {
                pi_a: ["0", "0", "0"],
                pi_b: [["0", "0"], ["0", "0"], ["0", "0"]],
                pi_c: ["0", "0", "0"],
                protocol: "groth16",
                curve: "bn254",
            },
            publicSignals: [],
        },
        isValid: false,
        _demo: true,
    },
    {
        id: "demo-oversized",
        label: "Oversized Payload",
        tier: TIER_CONFIG[2].name,
        tierIndex: 2,
        description: "Large but valid-shaped payload — tests resilience with extra-long field values.",
        proofPacket: makeSyntheticPacket(9999, 2),
        proofResult: {
            proof: makeSyntheticGroth16(9999),
            publicSignals: [
                "2",
                "0x" + "a]".repeat(128).replace(/]/g, "b"),
                BigInt(9999 * 7919).toString(),
                "0x" + "ff".repeat(256),
                "0x" + "ee".repeat(256),
            ],
        },
        isValid: true,
        isEdgeCase: true,
        _demo: true,
    },
];
