#![no_std]
use soroban_sdk::{contract, contractimpl, contracttype, Address, BytesN, Env};

/// A farming tier attestation badge.
///
/// The commitment hides the farmer's actual KALE balance:
///   commitment = sha256(farmer_address || balance || salt)
///
/// Only the tier (Sprout/Grower/Harvester/Whale) and the opaque commitment
/// are stored on-chain — never the raw balance.
///
/// Note: This is a commit-reveal scheme, not a full ZK proof system.
/// The client generates commitments using SHA-256 with a random salt.
/// Verification works by recomputing the hash from known inputs.
/// A future upgrade path is to add a ZK circuit (e.g. via CAP-0075)
/// that proves tier membership without revealing the balance at all.
#[contracttype]
#[derive(Clone, Debug)]
pub struct Badge {
    pub farmer: Address,
    pub tier: u32,
    pub commitment: BytesN<32>,
    pub timestamp: u64,
}

#[contracttype]
pub enum DataKey {
    Badge(Address),
}

#[contract]
pub struct ProofOfFarm;

#[contractimpl]
impl ProofOfFarm {
    /// Attest a farming tier with a cryptographic commitment.
    ///
    /// # Arguments
    /// * `farmer`     – Caller's address (requires auth)
    /// * `tier`       – Claimed tier (0-3)
    /// * `commitment` – sha256(address || balance || salt)
    ///
    /// # Panics
    /// If `tier > 3` or auth fails.
    pub fn attest(env: Env, farmer: Address, tier: u32, commitment: BytesN<32>) {
        farmer.require_auth();
        assert!(tier <= 3, "tier must be 0-3");

        let badge = Badge {
            farmer: farmer.clone(),
            tier,
            commitment,
            timestamp: env.ledger().timestamp(),
        };

        env.storage().persistent().set(&DataKey::Badge(farmer), &badge);
    }

    /// Look up any farmer's badge. Returns None if they haven't attested.
    pub fn verify(env: Env, farmer: Address) -> Option<Badge> {
        env.storage().persistent().get(&DataKey::Badge(farmer))
    }

    /// Map a raw KALE balance (7 decimals) to a tier index.
    ///
    ///   0 = Sprout    (0–99 KALE)
    ///   1 = Grower    (100–999 KALE)
    ///   2 = Harvester (1,000–9,999 KALE)
    ///   3 = Whale     (10,000+ KALE)
    pub fn get_tier_for_balance(_env: Env, balance: i128) -> u32 {
        let kale = balance / 10_000_000; // 7 decimal places
        match kale {
            k if k >= 10_000 => 3,
            k if k >= 1_000 => 2,
            k if k >= 100 => 1,
            _ => 0,
        }
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::Env;

    #[test]
    fn test_tier_thresholds() {
        let env = Env::default();
        let client = ProofOfFarmClient::new(&env, &env.register(ProofOfFarm, ()));

        assert_eq!(client.get_tier_for_balance(&0), 0);
        assert_eq!(client.get_tier_for_balance(&(99 * 10_000_000)), 0);
        assert_eq!(client.get_tier_for_balance(&(100 * 10_000_000)), 1);
        assert_eq!(client.get_tier_for_balance(&(999 * 10_000_000)), 1);
        assert_eq!(client.get_tier_for_balance(&(1_000 * 10_000_000)), 2);
        assert_eq!(client.get_tier_for_balance(&(9_999 * 10_000_000)), 2);
        assert_eq!(client.get_tier_for_balance(&(10_000 * 10_000_000)), 3);
        assert_eq!(client.get_tier_for_balance(&(100_000 * 10_000_000)), 3);
    }
}
