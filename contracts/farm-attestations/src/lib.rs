#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype, symbol_short,
    crypto::bn254::{Bn254G1Affine, Bn254G2Affine, Fr},
    Address, BytesN, Env, Symbol, Vec,
};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Nonce,
    Entry((Address, Symbol, Symbol)),
    // Appended (do not reorder): Groth16 VK registry for on-chain verification.
    Groth16Vk(Symbol),
}

#[derive(Clone)]
#[contracttype]
pub struct AttestationRecord {
    pub owner: Address,
    pub system: Symbol,
    pub tier: Symbol,
    pub statement_hash: BytesN<32>,
    pub verifier_hash: BytesN<32>,
    pub ledger: u32,
    pub timestamp: u64,
    pub attestation_id: u64,
}

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum Groth16Error {
    UnknownVk = 1,
    InvalidPublicInputs = 2,
    InvalidProof = 3,
}

#[derive(Clone)]
#[contracttype]
pub struct Groth16Proof {
    pub pi_a: BytesN<64>,
    pub pi_b: BytesN<128>,
    pub pi_c: BytesN<64>,
}

#[derive(Clone)]
#[contracttype]
pub struct Groth16VerificationKey {
    pub alpha_g1: BytesN<64>,
    pub beta_g2: BytesN<128>,
    pub gamma_g2: BytesN<128>,
    pub delta_g2: BytesN<128>,
    pub ic: Vec<BytesN<64>>,
}

#[contract]
pub struct FarmAttestations;

#[contractimpl]
impl FarmAttestations {
    pub fn version() -> u32 {
        2
    }

    pub fn is_initialized(env: Env) -> bool {
        env.storage().instance().has(&DataKey::Admin)
    }

    pub fn init_admin(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!();
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
        Self::bump_instance_ttl(&env);
    }

    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let admin = Self::admin(env.clone());
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
        Self::bump_instance_ttl(&env);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin = Self::admin(env.clone());
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
    }

    /// Extend instance TTL (admin/nonce). Anyone may call to keep the contract alive.
    pub fn extend_ttl(env: Env) {
        Self::bump_instance_ttl(&env);
    }

    /// Extend TTL of a specific attestation entry (persistent storage).
    /// Anyone may call; no state changes besides TTL.
    pub fn extend_entry_ttl(env: Env, owner: Address, system: Symbol, tier: Symbol) {
        let key = DataKey::Entry((owner, system, tier));
        if env.storage().persistent().has(&key) {
            Self::bump_persistent_key_ttl(&env, &key);
        }
    }

    /// Extend TTL of a specific Groth16 VK (persistent storage).
    /// Anyone may call; no state changes besides TTL.
    pub fn extend_vk_ttl(env: Env, vk_id: Symbol) {
        let key = DataKey::Groth16Vk(vk_id);
        if env.storage().persistent().has(&key) {
            Self::bump_persistent_key_ttl(&env, &key);
        }
    }

    // --------------------------------------------------------------------
    // Groth16 VK Registry (Admin-managed, Upgradeable)
    // --------------------------------------------------------------------

    /// Register or replace a Groth16 verification key under `vk_id`.
    ///
    /// This is the "universal" on-chain verification strategy for SMOL Labs:
    /// anything that can be represented as a BN254 Groth16 proof (Circom, and
    /// wrapped proofs like RISC0 receipts) can be verified here without new contracts.
    pub fn register_groth16_vk(env: Env, vk_id: Symbol, vk: Groth16VerificationKey) {
        let admin = Self::admin(env.clone());
        admin.require_auth();
        let key = DataKey::Groth16Vk(vk_id);
        env.storage().persistent().set(&key, &vk);
        Self::bump_persistent_key_ttl(&env, &key);
        Self::bump_instance_ttl(&env);
    }

    pub fn has_groth16_vk(env: Env, vk_id: Symbol) -> bool {
        env.storage().persistent().has(&DataKey::Groth16Vk(vk_id))
    }

    /// Verify Groth16 proof against registered VK, without storing anything.
    pub fn verify_groth16(
        env: Env,
        vk_id: Symbol,
        public_inputs: Vec<BytesN<32>>,
        proof: Groth16Proof,
    ) -> Result<bool, Groth16Error> {
        let vk: Groth16VerificationKey = env
            .storage()
            .persistent()
            .get(&DataKey::Groth16Vk(vk_id))
            .ok_or(Groth16Error::UnknownVk)?;

        Self::verify_groth16_internal(&env, &vk, &public_inputs, &proof)?;
        Ok(true)
    }

    /// Verify Groth16 proof and then store an attestation record (same schema as `attest`).
    ///
    /// This keeps the existing farm-attestations contract as the SSOT for "claims",
    /// while making some claims *cryptographically* verified on-chain.
    pub fn verify_groth16_and_attest(
        env: Env,
        owner: Address,
        system: Symbol,
        tier: Symbol,
        statement_hash: BytesN<32>,
        verifier_hash: BytesN<32>,
        vk_id: Symbol,
        public_inputs: Vec<BytesN<32>>,
        proof: Groth16Proof,
    ) -> Result<u64, Groth16Error> {
        owner.require_auth();

        let vk: Groth16VerificationKey = env
            .storage()
            .persistent()
            .get(&DataKey::Groth16Vk(vk_id))
            .ok_or(Groth16Error::UnknownVk)?;

        Self::verify_groth16_internal(&env, &vk, &public_inputs, &proof)?;

        // Reuse existing attest storage/event shape (reviewer-proof: the proof was verified above).
        let attestation_id = Self::next_nonce(&env);
        let ledger = env.ledger().sequence();
        let timestamp = env.ledger().timestamp();

        let record = AttestationRecord {
            owner: owner.clone(),
            system: system.clone(),
            tier: tier.clone(),
            statement_hash: statement_hash.clone(),
            verifier_hash: verifier_hash.clone(),
            ledger,
            timestamp,
            attestation_id,
        };

        let key = DataKey::Entry((owner.clone(), system.clone(), tier.clone()));
        env.storage().persistent().set(&key, &record);
        Self::bump_persistent_key_ttl(&env, &key);
        Self::bump_instance_ttl(&env);

        env.events().publish(
            (symbol_short!("attest"), owner, system, tier),
            (statement_hash, verifier_hash, ledger, timestamp, attestation_id),
        );

        Ok(attestation_id)
    }

    pub fn attest(
        env: Env,
        owner: Address,
        system: Symbol,
        tier: Symbol,
        statement_hash: BytesN<32>,
        verifier_hash: BytesN<32>,
    ) -> u64 {
        owner.require_auth();

        let attestation_id = Self::next_nonce(&env);
        let ledger = env.ledger().sequence();
        let timestamp = env.ledger().timestamp();

        let record = AttestationRecord {
            owner: owner.clone(),
            system: system.clone(),
            tier: tier.clone(),
            statement_hash: statement_hash.clone(),
            verifier_hash: verifier_hash.clone(),
            ledger,
            timestamp,
            attestation_id,
        };

        let key = DataKey::Entry((owner.clone(), system.clone(), tier.clone()));
        env.storage().persistent().set(&key, &record);
        Self::bump_persistent_key_ttl(&env, &key);
        Self::bump_instance_ttl(&env);

        env.events().publish(
            (symbol_short!("attest"), owner, system, tier),
            (statement_hash, verifier_hash, ledger, timestamp, attestation_id),
        );

        attestation_id
    }

    pub fn get(env: Env, owner: Address, system: Symbol, tier: Symbol) -> Option<AttestationRecord> {
        let key = DataKey::Entry((owner, system, tier));
        env.storage().persistent().get(&key)
    }

    pub fn has(
        env: Env,
        owner: Address,
        system: Symbol,
        tier: Symbol,
        statement_hash: BytesN<32>,
    ) -> bool {
        let key = DataKey::Entry((owner, system, tier));
        match env.storage().persistent().get::<DataKey, AttestationRecord>(&key) {
            Some(record) => record.statement_hash == statement_hash,
            None => false,
        }
    }

    fn next_nonce(env: &Env) -> u64 {
        let current = env.storage().instance().get::<DataKey, u64>(&DataKey::Nonce).unwrap_or(0);
        let next = current + 1;
        env.storage().instance().set(&DataKey::Nonce, &next);
        next
    }

    fn bump_instance_ttl(env: &Env) {
        let max = env.storage().max_ttl();
        let threshold = if max > 1 { max / 2 } else { 1 };
        env.storage().instance().extend_ttl(threshold, max);
    }

    fn bump_persistent_key_ttl(env: &Env, key: &DataKey) {
        let max = env.storage().max_ttl();
        let threshold = if max > 1 { max / 2 } else { 1 };
        env.storage().persistent().extend_ttl(key, threshold, max);
    }

    fn verify_groth16_internal(
        env: &Env,
        vk: &Groth16VerificationKey,
        public_inputs: &Vec<BytesN<32>>,
        proof: &Groth16Proof,
    ) -> Result<(), Groth16Error> {
        // VK_IC length must be public_inputs.len()+1
        if vk.ic.len() != public_inputs.len() + 1 {
            return Err(Groth16Error::InvalidPublicInputs);
        }

        let bn254 = env.crypto().bn254();

        let pi_a = Bn254G1Affine::from_bytes(proof.pi_a.clone());
        let pi_b = Bn254G2Affine::from_bytes(proof.pi_b.clone());
        let pi_c = Bn254G1Affine::from_bytes(proof.pi_c.clone());

        let alpha_g1 = Bn254G1Affine::from_bytes(vk.alpha_g1.clone());
        let beta_g2 = Bn254G2Affine::from_bytes(vk.beta_g2.clone());
        let gamma_g2 = Bn254G2Affine::from_bytes(vk.gamma_g2.clone());
        let delta_g2 = Bn254G2Affine::from_bytes(vk.delta_g2.clone());

        let mut vk_x = Bn254G1Affine::from_bytes(vk.ic.get(0).unwrap());
        for i in 0..public_inputs.len() {
            let scalar_bytes = public_inputs.get(i).unwrap();
            let scalar = Fr::from_bytes(scalar_bytes.clone());

            // Skip multiplication if scalar is zero.
            let mut is_zero = true;
            for b in scalar_bytes.iter() {
                if b != 0 {
                    is_zero = false;
                    break;
                }
            }
            if !is_zero {
                let ic_point = Bn254G1Affine::from_bytes(vk.ic.get(i + 1).unwrap());
                let term = bn254.g1_mul(&ic_point, &scalar);
                vk_x = bn254.g1_add(&vk_x, &term);
            }
        }

        // Negate pi_a by multiplying with -1 mod r.
        let r_minus_one = BytesN::from_array(env, &[
            0x30, 0x64, 0x4e, 0x72, 0xe1, 0x31, 0xa0, 0x29,
            0xb8, 0x50, 0x45, 0xb6, 0x81, 0x81, 0x58, 0x5d,
            0x28, 0x33, 0xe8, 0x48, 0x79, 0xb9, 0x70, 0x91,
            0x43, 0xe1, 0xf5, 0x93, 0xf0, 0x00, 0x00, 0x00,
        ]);
        let fr_neg_one = Fr::from_bytes(r_minus_one);
        let pi_a_neg = bn254.g1_mul(&pi_a, &fr_neg_one);

        let mut g1_points: Vec<Bn254G1Affine> = Vec::new(env);
        let mut g2_points: Vec<Bn254G2Affine> = Vec::new(env);

        g1_points.push_back(pi_a_neg);
        g2_points.push_back(pi_b);

        g1_points.push_back(alpha_g1);
        g2_points.push_back(beta_g2);

        g1_points.push_back(vk_x);
        g2_points.push_back(gamma_g2);

        g1_points.push_back(pi_c);
        g2_points.push_back(delta_g2);

        if !bn254.pairing_check(g1_points, g2_points) {
            return Err(Groth16Error::InvalidProof);
        }

        Ok(())
    }
}
