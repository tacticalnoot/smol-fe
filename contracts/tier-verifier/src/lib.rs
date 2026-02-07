//! Tier Verifier — Groth16 ZK Proof Verification for Proof of Farm
//!
//! Verifies Groth16 zero-knowledge proofs on-chain using Stellar Protocol 25
//! BN254 host functions (CAP-0074). Provers demonstrate tier membership without
//! revealing their KALE balance.
//!
//! ## How it works
//! 1. Client generates a Groth16 proof using snarkjs (browser-side)
//! 2. Proof is serialized and submitted to this contract
//! 3. Contract performs on-chain pairing check using native BN254 ops
//! 4. If valid, an attestation is stored on-chain
//!
//! ## Verification Key
//! The verification key is stored on initialization and encodes the circuit
//! parameters from the tier_proof.circom circuit.

#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    crypto::bn254::{Bn254, Bn254G1Affine, Bn254G2Affine, Fr},
    Address, BytesN, Env, Symbol, Vec, U256,
};

// ============================================================================
// Errors
// ============================================================================

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum TierVerifierError {
    InvalidProof = 1,
    InvalidTier = 2,
    NotAdmin = 3,
    AlreadyInitialized = 4,
    NotInitialized = 5,
    InvalidPublicInputs = 6,
}

// ============================================================================
// Types
// ============================================================================

/// A verified tier attestation stored on-chain
#[derive(Clone)]
#[contracttype]
pub struct TierAttestation {
    pub farmer: Address,
    pub tier: u32,
    pub commitment: BytesN<32>,
    pub verified_at: u64,
}

/// Groth16 proof points (BN254 curve)
/// pi_a: G1 point (64 bytes uncompressed)
/// pi_b: G2 point (128 bytes uncompressed)
/// pi_c: G1 point (64 bytes uncompressed)
#[derive(Clone)]
#[contracttype]
pub struct Groth16Proof {
    pub pi_a: BytesN<64>,
    pub pi_b: BytesN<128>,
    pub pi_c: BytesN<64>,
}

/// Groth16 verification key stored on-chain
/// This encodes the circuit-specific parameters from tier_proof.circom
#[derive(Clone)]
#[contracttype]
pub struct VerificationKey {
    pub alpha_g1: BytesN<64>,
    pub beta_g2: BytesN<128>,
    pub gamma_g2: BytesN<128>,
    pub delta_g2: BytesN<128>,
    /// IC points: one for each public input + 1
    /// For tier_proof: 3 IC points (1 base + 2 public inputs)
    pub ic: Vec<BytesN<64>>,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Vkey,
    Attestation(Address),
}

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct TierVerifier;

#[contractimpl]
impl TierVerifier {
    // ========================================================================
    // Admin Functions
    // ========================================================================

    /// Initialize the contract with an admin address and verification key.
    pub fn initialize(
        env: Env,
        admin: Address,
        vkey: VerificationKey,
    ) -> Result<(), TierVerifierError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(TierVerifierError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Vkey, &vkey);
        Ok(())
    }

    /// Upgrade the contract to a new WASM hash. Only callable by admin.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), TierVerifierError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(TierVerifierError::NotAdmin)?;
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    /// Update the verification key (e.g. after circuit changes). Admin only.
    pub fn set_vkey(env: Env, vkey: VerificationKey) -> Result<(), TierVerifierError> {
        let admin: Address = env
            .storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(TierVerifierError::NotAdmin)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Vkey, &vkey);
        Ok(())
    }

    // ========================================================================
    // Groth16 Verification
    // ========================================================================

    /// Verify a Groth16 proof and store the tier attestation on-chain.
    ///
    /// This performs the full Groth16 pairing check:
    ///   e(pi_a, pi_b) == e(alpha, beta) * e(vk_x, gamma) * e(pi_c, delta)
    ///
    /// Which is equivalent to checking:
    ///   e(-pi_a, pi_b) * e(alpha, beta) * e(vk_x, gamma) * e(pi_c, delta) == 1
    ///
    /// Where vk_x = IC[0] + sum(pub_input[i] * IC[i+1])
    ///
    /// # Arguments
    /// * `farmer` - Address of the farmer (requires auth)
    /// * `tier` - Claimed tier (0-3, public input to circuit)
    /// * `commitment` - Poseidon commitment (public input to circuit)
    /// * `proof` - The Groth16 proof (pi_a, pi_b, pi_c)
    pub fn verify_and_attest(
        env: Env,
        farmer: Address,
        tier: u32,
        commitment: BytesN<32>,
        proof: Groth16Proof,
    ) -> Result<bool, TierVerifierError> {
        // Validate tier range
        if tier > 3 {
            return Err(TierVerifierError::InvalidTier);
        }

        // Require farmer auth
        farmer.require_auth();

        // Load verification key
        let vkey: VerificationKey = env
            .storage()
            .instance()
            .get(&DataKey::Vkey)
            .ok_or(TierVerifierError::NotInitialized)?;

        // We need exactly 3 IC points for 2 public inputs
        if vkey.ic.len() != 3 {
            return Err(TierVerifierError::InvalidPublicInputs);
        }

        let bn254 = env.crypto().bn254();

        // Decode proof points
        let pi_a = Bn254G1Affine::from_bytes(proof.pi_a);
        let pi_b = Bn254G2Affine::from_bytes(proof.pi_b);
        let pi_c = Bn254G1Affine::from_bytes(proof.pi_c);

        // Decode verification key points
        let alpha_g1 = Bn254G1Affine::from_bytes(vkey.alpha_g1);
        let beta_g2 = Bn254G2Affine::from_bytes(vkey.beta_g2);
        let gamma_g2 = Bn254G2Affine::from_bytes(vkey.gamma_g2);
        let delta_g2 = Bn254G2Affine::from_bytes(vkey.delta_g2);

        // Decode IC points
        let ic0 = Bn254G1Affine::from_bytes(vkey.ic.get(0).unwrap());
        let ic1 = Bn254G1Affine::from_bytes(vkey.ic.get(1).unwrap());
        let ic2 = Bn254G1Affine::from_bytes(vkey.ic.get(2).unwrap());

        // Public inputs: [tier_id, commitment_expected]
        // Convert tier to scalar
        let tier_scalar = Fr::from_u256(U256::from_u32(&env, tier));

        // Convert commitment to scalar (it's a Poseidon field element)
        let commitment_scalar = Fr::from_bytes(commitment.clone());

        // Compute vk_x = IC[0] + tier * IC[1] + commitment * IC[2]
        let term1 = bn254.g1_mul(&ic1, &tier_scalar);
        let term2 = bn254.g1_mul(&ic2, &commitment_scalar);
        let vk_x = bn254.g1_add(&ic0, &bn254.g1_add(&term1, &term2));

        // Negate pi_a for the pairing check
        // Negation of G1 point: negate the y-coordinate
        let pi_a_neg = negate_g1(&env, &pi_a);

        // Groth16 pairing check:
        // e(-pi_a, pi_b) * e(alpha, beta) * e(vk_x, gamma) * e(pi_c, delta) == 1
        let mut g1_points: Vec<Bn254G1Affine> = Vec::new(&env);
        let mut g2_points: Vec<Bn254G2Affine> = Vec::new(&env);

        g1_points.push_back(pi_a_neg);
        g2_points.push_back(pi_b);

        g1_points.push_back(alpha_g1);
        g2_points.push_back(beta_g2);

        g1_points.push_back(vk_x);
        g2_points.push_back(gamma_g2);

        g1_points.push_back(pi_c);
        g2_points.push_back(delta_g2);

        let pairing_valid = bn254.pairing_check(g1_points, g2_points);

        if !pairing_valid {
            return Err(TierVerifierError::InvalidProof);
        }

        // Proof is valid — store attestation
        let attestation = TierAttestation {
            farmer: farmer.clone(),
            tier,
            commitment,
            verified_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Attestation(farmer.clone()), &attestation);

        // Emit event
        env.events().publish(
            (Symbol::new(&env, "TierVerified"),),
            (farmer, tier),
        );

        Ok(true)
    }

    /// Legacy attestation for backwards compatibility during migration.
    /// Stores attestation with proof hash for off-chain verification.
    /// Will be deprecated once all clients upgrade to verify_and_attest.
    pub fn attest_tier(
        env: Env,
        farmer: Address,
        tier: u32,
        commitment: BytesN<32>,
        proof_hash: BytesN<32>,
    ) -> Result<bool, TierVerifierError> {
        if tier > 3 {
            return Err(TierVerifierError::InvalidTier);
        }

        farmer.require_auth();

        let attestation = TierAttestation {
            farmer: farmer.clone(),
            tier,
            commitment,
            verified_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Attestation(farmer.clone()), &attestation);

        env.events().publish(
            (Symbol::new(&env, "TierAttested"),),
            (farmer, tier, proof_hash),
        );

        Ok(true)
    }

    /// Lookup a farmer's tier attestation.
    pub fn get_attestation(env: Env, farmer: Address) -> Option<TierAttestation> {
        env.storage()
            .persistent()
            .get(&DataKey::Attestation(farmer))
    }
}

// ============================================================================
// Helpers
// ============================================================================

/// Negate a G1 affine point by negating its y-coordinate.
/// BN254 field modulus: 0x30644e72e131a029b85045b68181585d97816a916871ca8d3c208c16d87cfd47
fn negate_g1(env: &Env, point: &Bn254G1Affine) -> Bn254G1Affine {
    let bytes = point.to_array();
    let mut result = [0u8; 64];

    // Copy x-coordinate unchanged (bytes 0..32)
    result[..32].copy_from_slice(&bytes[..32]);

    // Negate y-coordinate: y_neg = FIELD_MODULUS - y
    // BN254 base field modulus
    let modulus: [u8; 32] = [
        0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
        0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
        0x97, 0x81, 0x6a, 0x91, 0x68, 0x71, 0xca, 0x8d,
        0x3c, 0x20, 0x8c, 0x16, 0xd8, 0x7c, 0xfd, 0x47,
    ];

    // Subtract y from modulus (big-endian)
    let mut borrow: u16 = 0;
    for i in (0..32).rev() {
        let diff = (modulus[i] as u16) - (bytes[32 + i] as u16) - borrow;
        if diff > 255 {
            result[32 + i] = (diff + 256) as u8;
            borrow = 1;
        } else {
            result[32 + i] = diff as u8;
            borrow = 0;
        }
    }

    Bn254G1Affine::from_array(env, &result)
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::Address as _;
    use soroban_sdk::Env;

    #[test]
    fn test_initialize() {
        let env = Env::default();
        let contract_id = env.register(TierVerifier, ());
        let client = TierVerifierClient::new(&env, &contract_id);

        let admin = Address::generate(&env);

        // Build a dummy vkey for test (not a real verification key)
        let ic: Vec<BytesN<64>> = Vec::new(&env);

        let vkey = VerificationKey {
            alpha_g1: BytesN::from_array(&env, &[0u8; 64]),
            beta_g2: BytesN::from_array(&env, &[0u8; 128]),
            gamma_g2: BytesN::from_array(&env, &[0u8; 128]),
            delta_g2: BytesN::from_array(&env, &[0u8; 128]),
            ic,
        };

        client.initialize(&admin, &vkey);

        // Second init should fail
        let result = client.try_initialize(&admin, &vkey);
        assert!(result.is_err());
    }

    #[test]
    fn test_legacy_attest_tier() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(TierVerifier, ());
        let client = TierVerifierClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let farmer = Address::generate(&env);

        let ic: Vec<BytesN<64>> = Vec::new(&env);
        let vkey = VerificationKey {
            alpha_g1: BytesN::from_array(&env, &[0u8; 64]),
            beta_g2: BytesN::from_array(&env, &[0u8; 128]),
            gamma_g2: BytesN::from_array(&env, &[0u8; 128]),
            delta_g2: BytesN::from_array(&env, &[0u8; 128]),
            ic,
        };

        client.initialize(&admin, &vkey);

        let commitment = BytesN::from_array(&env, &[1u8; 32]);
        let proof_hash = BytesN::from_array(&env, &[2u8; 32]);

        let result = client.attest_tier(&farmer, &2, &commitment, &proof_hash);
        assert!(result);

        let attestation = client.get_attestation(&farmer);
        assert!(attestation.is_some());
        let att = attestation.unwrap();
        assert_eq!(att.tier, 2);
    }

    #[test]
    fn test_invalid_tier() {
        let env = Env::default();
        env.mock_all_auths();
        let contract_id = env.register(TierVerifier, ());
        let client = TierVerifierClient::new(&env, &contract_id);

        let admin = Address::generate(&env);
        let farmer = Address::generate(&env);

        let ic: Vec<BytesN<64>> = Vec::new(&env);
        let vkey = VerificationKey {
            alpha_g1: BytesN::from_array(&env, &[0u8; 64]),
            beta_g2: BytesN::from_array(&env, &[0u8; 128]),
            gamma_g2: BytesN::from_array(&env, &[0u8; 128]),
            delta_g2: BytesN::from_array(&env, &[0u8; 128]),
            ic,
        };

        client.initialize(&admin, &vkey);

        let commitment = BytesN::from_array(&env, &[1u8; 32]);
        let proof_hash = BytesN::from_array(&env, &[2u8; 32]);

        let result = client.try_attest_tier(&farmer, &5, &commitment, &proof_hash);
        assert!(result.is_err());
    }
}
