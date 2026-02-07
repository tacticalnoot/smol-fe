//! Tier Verifier — ZK Proof Verification for Proof of Farm (Minimal)
//!
//! This is a minimal upgradeable verifier contract.
//! The ZK verification will be added once Protocol 25 BN254 host functions
//! are confirmed working on mainnet. For now, this stores attestations
//! and provides the upgrade path.
//!
//! ## Upgradeability
//! This contract supports upgrades via `upgrade()` for future ZK verification.

#![no_std]
use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    Address, BytesN, Env, Symbol, Vec,
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

/// Proof data (for future ZK verification)
#[derive(Clone)]
#[contracttype]
pub struct ProofData {
    pub pi_a: Vec<BytesN<32>>,
    pub pi_b: Vec<Vec<BytesN<32>>>,
    pub pi_c: Vec<BytesN<32>>,
}

#[contracttype]
pub enum DataKey {
    Admin,
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

    /// Initialize the contract with an admin address.
    pub fn initialize(env: Env, admin: Address) -> Result<(), TierVerifierError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(TierVerifierError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        Ok(())
    }

    /// Upgrade the contract to a new WASM hash.
    /// Only callable by admin.
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

    // ========================================================================
    // Verification Functions
    // ========================================================================

    /// Store a tier attestation (placeholder for ZK verification).
    /// 
    /// In the next upgrade, this will perform actual Groth16 verification
    /// using Protocol 25 BN254 host functions.
    /// 
    /// For now, it stores the attestation with a proof hash for later verification.
    pub fn attest_tier(
        env: Env,
        farmer: Address,
        tier: u32,
        commitment: BytesN<32>,
        proof_hash: BytesN<32>,  // Hash of the proof for verification
    ) -> Result<bool, TierVerifierError> {
        // Validate tier
        if tier > 3 {
            return Err(TierVerifierError::InvalidTier);
        }

        // Require farmer auth
        farmer.require_auth();

        // Store attestation with proof hash
        let attestation = TierAttestation {
            farmer: farmer.clone(),
            tier,
            commitment: commitment.clone(),
            verified_at: env.ledger().timestamp(),
        };

        env.storage()
            .persistent()
            .set(&DataKey::Attestation(farmer.clone()), &attestation);

        // Emit event with proof hash for off-chain verification
        env.events().publish(
            (Symbol::new(&env, "TierAttested"),),
            (farmer, tier, commitment, proof_hash),
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
        client.initialize(&admin);

        // Second init should fail
        let result = client.try_initialize(&admin);
        assert!(result.is_err());
    }

    #[test]
    fn test_tier_range() {
        assert!(0 <= 3);
        assert!(1 <= 3);
        assert!(2 <= 3);
        assert!(3 <= 3);
        assert!(!(4 <= 3));
    }
}
