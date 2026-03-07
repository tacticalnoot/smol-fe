export type SppResearchStatus = "present" | "shadowed" | "missing";

export interface SppResearchContractMethod {
    name: string;
    summary: string;
}

export interface SppResearchContractSurface {
    id: "pool" | "verifier" | "asp_membership" | "asp_non_membership";
    label: string;
    status: SppResearchStatus;
    role: string;
    sourceHref: string;
    constructorSignature: string;
    entrypoints: SppResearchContractMethod[];
    emittedData: string[];
    labBinding: string;
}

export interface SppResearchStoreSurface {
    name: string;
    purpose: string;
}

export interface SppResearchWorkstream {
    id: string;
    label: string;
    status: SppResearchStatus;
    summary: string;
}

export interface SppResearchModel {
    summary: {
        contractCount: number;
        storeCount: number;
        workstreamCount: number;
        presentCount: number;
        shadowedCount: number;
        missingCount: number;
    };
    contracts: SppResearchContractSurface[];
    stores: SppResearchStoreSurface[];
    workstreams: SppResearchWorkstream[];
}

const REPO_BASE =
    "https://github.com/NethermindEth/stellar-private-payments/blob/main";

export const sppResearchContracts: SppResearchContractSurface[] = [
    {
        id: "pool",
        label: "Privacy Pool",
        status: "missing",
        role: "Owns commitments, nullifiers, token in/out, encrypted outputs, and private transact flow.",
        sourceHref: `${REPO_BASE}/contracts/pool/src/pool.rs`,
        constructorSignature:
            "__constructor(admin, token, verifier, asp_membership, asp_non_membership, maximum_deposit_amount, levels)",
        entrypoints: [
            {
                name: "transact",
                summary:
                    "Proof-driven deposit, transfer, or withdraw via ext_amount and ext_data.",
            },
            {
                name: "register",
                summary:
                    "Publishes encryption and note public keys for private recipients.",
            },
            {
                name: "get_root",
                summary: "Returns the live commitment Merkle root.",
            },
            {
                name: "is_spent",
                summary: "Checks whether a nullifier has already been consumed.",
            },
        ],
        emittedData: [
            "new commitments",
            "encrypted outputs",
            "spent nullifiers",
        ],
        labBinding:
            "No contract binding in Labs yet. Current page only binds receipts to public settlement.",
    },
    {
        id: "verifier",
        label: "Circom Groth16 Verifier",
        status: "missing",
        role: "Verifies BN254 Groth16 proofs against the stored verification key.",
        sourceHref: `${REPO_BASE}/contracts/circom-groth16-verifier/src/lib.rs`,
        constructorSignature: "__constructor(vk)",
        entrypoints: [
            {
                name: "verify",
                summary:
                    "Validates a Groth16 proof plus public inputs against the verification key.",
            },
        ],
        emittedData: ["proof validity result"],
        labBinding:
            "No verifier binding in Labs. No browser proving or proof submission exists in smol-fe.",
    },
    {
        id: "asp_membership",
        label: "ASP Membership Tree",
        status: "shadowed",
        role: "Maintains the approved-set Merkle root used by the pool proof inputs.",
        sourceHref: `${REPO_BASE}/contracts/asp-membership/src/lib.rs`,
        constructorSignature: "__constructor(admin, levels)",
        entrypoints: [
            {
                name: "get_root",
                summary: "Returns the membership Merkle root.",
            },
            {
                name: "insert_leaf",
                summary:
                    "Adds approved leaves and updates the root.",
            },
            {
                name: "set_admin_insert_only",
                summary:
                    "Toggles whether only the admin may insert leaves.",
            },
            {
                name: "update_admin",
                summary: "Transfers admin control.",
            },
        ],
        emittedData: ["leaf added", "root updates"],
        labBinding:
            "Labs shadows ASP policy locally through receipts, but does not query or maintain a real membership root.",
    },
    {
        id: "asp_non_membership",
        label: "ASP Non-Membership Tree",
        status: "shadowed",
        role: "Maintains the blocked-set sparse Merkle tree for exclusion proofs.",
        sourceHref: `${REPO_BASE}/contracts/asp-non-membership/src/lib.rs`,
        constructorSignature: "__constructor(admin)",
        entrypoints: [
            {
                name: "get_root",
                summary: "Returns the sparse Merkle root.",
            },
            {
                name: "find_key",
                summary:
                    "Returns non-membership witness data for a key.",
            },
            {
                name: "insert",
                summary: "Adds blocked leaves to the sparse tree.",
            },
            {
                name: "remove",
                summary: "Deletes blocked leaves and rewrites the root.",
            },
        ],
        emittedData: ["leaf inserted", "leaf updated", "leaf deleted"],
        labBinding:
            "Labs shadows exclusion policy locally, but does not fetch contract witnesses or sparse-tree roots.",
    },
];

export const sppResearchStores: SppResearchStoreSurface[] = [
    {
        name: "retention_config",
        purpose: "Caches RPC retention window behavior.",
    },
    {
        name: "sync_metadata",
        purpose: "Tracks cursors, last synced ledger, and per-network sync state.",
    },
    {
        name: "pool_leaves",
        purpose: "Stores commitment Merkle leaves for local proof generation.",
    },
    {
        name: "pool_nullifiers",
        purpose: "Stores spent nullifiers to prevent local double-use.",
    },
    {
        name: "pool_encrypted_outputs",
        purpose: "Stores encrypted note payloads for note scanning.",
    },
    {
        name: "asp_membership_leaves",
        purpose: "Stores approved-set Merkle leaves and roots.",
    },
    {
        name: "user_notes",
        purpose: "Stores discovered notes, owners, spent status, and leaf indices.",
    },
    {
        name: "registered_public_keys",
        purpose: "Stores recipient encryption and note public keys.",
    },
];

export const sppResearchWorkstreams: SppResearchWorkstream[] = [
    {
        id: "policy_receipts",
        label: "ASP policy receipts",
        status: "shadowed",
        summary:
            "Current Labs page generates policy receipts locally, but not from ASP contract state.",
    },
    {
        id: "commitment_artifacts",
        label: "Commitment and disclosure artifacts",
        status: "present",
        summary:
            "Mainnet-safe receipts, commitment ids, and selective-disclosure artifacts already exist in the experiment page.",
    },
    {
        id: "settlement_binding",
        label: "Public settlement binding",
        status: "present",
        summary:
            "Receipts are bound to real public mainnet transaction hashes when the app has them.",
    },
    {
        id: "protected_requests",
        label: "Protected receive request packaging",
        status: "present",
        summary:
            "Receive requests can export encrypted metadata packages in non-public research modes.",
    },
    {
        id: "pool_binding",
        label: "Pool contract binding",
        status: "missing",
        summary:
            "No pool contract addresses, clients, or contract events are wired into Labs.",
    },
    {
        id: "verifier_binding",
        label: "Verifier binding",
        status: "missing",
        summary:
            "No proof verifier client or verification-key configuration is wired into Labs.",
    },
    {
        id: "key_registration",
        label: "Recipient key registration",
        status: "missing",
        summary:
            "No private recipient registration flow exists for note and encryption keys.",
    },
    {
        id: "sync_controller",
        label: "Merkle sync controller",
        status: "missing",
        summary:
            "No IndexedDB sync layer exists for commitments, nullifiers, or ASP leaves.",
    },
    {
        id: "note_scanner",
        label: "Note scanner and note store",
        status: "missing",
        summary:
            "No encrypted-output scan, note decryption, or note ownership discovery exists.",
    },
    {
        id: "proof_pipeline",
        label: "Browser proving pipeline",
        status: "missing",
        summary:
            "No circuit witness builder, proof worker, or wasm proving pipeline exists in smol-fe.",
    },
    {
        id: "transact_builder",
        label: "SPP transact builder",
        status: "missing",
        summary:
            "No builder exists for private deposit, transfer, or withdraw transactions.",
    },
];

export function getSppResearchModel(): SppResearchModel {
    const statusValues = [
        ...sppResearchContracts.map((item) => item.status),
        ...sppResearchWorkstreams.map((item) => item.status),
    ];

    return {
        summary: {
            contractCount: sppResearchContracts.length,
            storeCount: sppResearchStores.length,
            workstreamCount: sppResearchWorkstreams.length,
            presentCount: statusValues.filter((value) => value === "present")
                .length,
            shadowedCount: statusValues.filter((value) => value === "shadowed")
                .length,
            missingCount: statusValues.filter((value) => value === "missing")
                .length,
        },
        contracts: sppResearchContracts,
        stores: sppResearchStores,
        workstreams: sppResearchWorkstreams,
    };
}
