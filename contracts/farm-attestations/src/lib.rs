#![no_std]

use soroban_sdk::{
    contract, contractimpl, contracttype, symbol_short, Address, BytesN, Env, Symbol,
};

#[derive(Clone)]
#[contracttype]
pub enum DataKey {
    Admin,
    Nonce,
    Entry((Address, Symbol, Symbol)),
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

#[contract]
pub struct FarmAttestations;

#[contractimpl]
impl FarmAttestations {
    pub fn init_admin(env: Env, admin: Address) {
        if env.storage().instance().has(&DataKey::Admin) {
            panic!();
        }
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &admin);
    }

    pub fn admin(env: Env) -> Address {
        env.storage().instance().get(&DataKey::Admin).unwrap()
    }

    pub fn set_admin(env: Env, new_admin: Address) {
        let admin = Self::admin(env.clone());
        admin.require_auth();
        env.storage().instance().set(&DataKey::Admin, &new_admin);
    }

    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) {
        let admin = Self::admin(env.clone());
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
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
}
