//! Commitment Pool — ZK Private Payment Escrow for Stellar
//!
//! ⚠️  PRE-ALPHA / RESEARCH — NOT FOR PRODUCTION USE ⚠️
//!
//! This contract implements the on-chain enforcement layer for the
//! Discombobulator ZK commitment-note scheme. It demonstrates that
//! ZK-based private payments are possible on Stellar/Soroban today
//! using Protocol 25 BN254 host functions.
//!
//! ## How it works
//!
//! 1. DEPOSIT: A user deposits tokens along with a Poseidon commitment
//!    C = Poseidon(secret, amount, nullifier). The commitment is recorded
//!    on-chain but the secret and nullifier stay private with the user.
//!
//! 2. WITHDRAW: Anyone holding (secret, nullifier) can generate a Groth16
//!    proof proving they know the preimage of C, then call withdraw() with
//!    any recipient address. The contract verifies the proof on-chain via
//!    the existing TierVerifier contract, checks the nullifier has not been
//!    spent, then transfers the funds to the specified recipient.
//!
//! This is a bearer-note escrow primitive, not an anonymity-set mixer.
//!
//! ## Cross-contract verification
//!
//! Proof verification is delegated to the deployed TierVerifier contract
//! (CAU7NET7FXSFBBRMLM6X7CJMVAIHMG7RC4YPCXG6G4YOYG6C3CVGR25M on mainnet).
//!
//! ## Circuit mapping (kale_tier circuit reuse)
//!
//! Private inputs: address_hash=secret, balance=amount, salt=nullifier
//! Public inputs:  tier_id=amount, commitment_expected=C
//!
//! ## Disclaimer
//!
//! Not audited. Pre-alpha. Do not use with funds you cannot afford to lose.

#![no_std]

use soroban_sdk::{
    contract, contracterror, contractimpl, contracttype,
    token, Address, BytesN, Env, Symbol, Vec,
};

// ============================================================================
// TierVerifier cross-contract interface
// Isolated in its own module so its DataKey does not conflict with ours.
// ============================================================================

mod verifier {
    soroban_sdk::contractimport!(
        file = "../tier-verifier/target/wasm32v1-none/release/tier_verifier.wasm",
    );
}

/// Groth16 proof — re-export from the verifier interface for callers.
pub use verifier::Groth16Proof;

// ============================================================================
// Errors
// ============================================================================

#[contracterror]
#[derive(Copy, Clone, Debug, Eq, PartialEq, PartialOrd, Ord)]
#[repr(u32)]
pub enum PoolError {
    AlreadyInitialized = 1,
    NotInitialized = 2,
    NotAdmin = 3,
    CommitmentAlreadyDeposited = 4,
    CommitmentNotFound = 5,
    NullifierAlreadySpent = 6,
    InvalidProof = 7,
    InvalidAmount = 8,
}

const WITHDRAW_STATEMENT_VERSION: u32 = 1;

// ============================================================================
// Data structures
// ============================================================================

/// A record of a deposit held in escrow.
#[derive(Clone)]
#[contracttype]
pub struct DepositRecord {
    pub commitment: BytesN<32>,
    pub token: Address,
    /// Amount in stroops
    pub amount: i128,
    /// Original depositor (event logging only — not used for auth on withdraw)
    pub depositor: Address,
    pub deposited_at: u64,
}

#[contracttype]
pub enum DataKey {
    Admin,
    Verifier,
    Deposit(BytesN<32>),
    NullifierUsed(BytesN<32>),
}

// ============================================================================
// Contract
// ============================================================================

#[contract]
pub struct CommitmentPool;

#[contractimpl]
impl CommitmentPool {
    // ========================================================================
    // Admin
    // ========================================================================

    /// Initialize with admin + TierVerifier contract address.
    pub fn initialize(
        env: Env,
        admin: Address,
        verifier: Address,
    ) -> Result<(), PoolError> {
        if env.storage().instance().has(&DataKey::Admin) {
            return Err(PoolError::AlreadyInitialized);
        }
        env.storage().instance().set(&DataKey::Admin, &admin);
        env.storage().instance().set(&DataKey::Verifier, &verifier);
        env.events().publish(
            (Symbol::new(&env, "Initialized"),),
            (admin, verifier),
        );
        Ok(())
    }

    /// Replace the verifier contract address. Admin only.
    pub fn set_verifier(env: Env, verifier: Address) -> Result<(), PoolError> {
        let admin = Self::require_admin(&env)?;
        admin.require_auth();
        env.storage().instance().set(&DataKey::Verifier, &verifier);
        Ok(())
    }

    /// Upgrade this contract WASM. Admin only.
    pub fn upgrade(env: Env, new_wasm_hash: BytesN<32>) -> Result<(), PoolError> {
        let admin = Self::require_admin(&env)?;
        admin.require_auth();
        env.deployer().update_current_contract_wasm(new_wasm_hash);
        Ok(())
    }

    /// Extend storage TTL. Anyone may call.
    pub fn extend_ttl(env: Env) {
        let max_ttl = env.storage().max_ttl();
        env.storage().instance().extend_ttl(max_ttl, max_ttl);
    }

    // ========================================================================
    // Deposit
    // ========================================================================

    /// Deposit tokens and register a Poseidon commitment.
    ///
    /// commitment = 32-byte big-endian encoding of
    ///   Poseidon(secret_bigint, amount_bigint, nullifier_bigint)
    /// computed client-side by generateCommitmentKey().
    pub fn deposit(
        env: Env,
        depositor: Address,
        token: Address,
        amount: i128,
        commitment: BytesN<32>,
    ) -> Result<(), PoolError> {
        if amount <= 0 {
            return Err(PoolError::InvalidAmount);
        }

        depositor.require_auth();

        if env.storage().persistent().has(&DataKey::Deposit(commitment.clone())) {
            return Err(PoolError::CommitmentAlreadyDeposited);
        }

        // Pull funds into escrow
        token::Client::new(&env, &token).transfer(
            &depositor,
            &env.current_contract_address(),
            &amount,
        );

        let record = DepositRecord {
            commitment: commitment.clone(),
            token: token.clone(),
            amount,
            depositor: depositor.clone(),
            deposited_at: env.ledger().timestamp(),
        };

        let max_ttl = env.storage().max_ttl();
        env.storage()
            .persistent()
            .set(&DataKey::Deposit(commitment.clone()), &record);
        env.storage().persistent().extend_ttl(
            &DataKey::Deposit(commitment.clone()),
            max_ttl,
            max_ttl,
        );

        env.events().publish(
            (Symbol::new(&env, "Deposited"),),
            (commitment, amount, token, depositor),
        );

        Ok(())
    }

    // ========================================================================
    // Withdraw
    // ========================================================================

    /// Withdraw escrowed tokens to any recipient by presenting a valid ZK proof.
    ///
    /// The caller proves knowledge of (secret, nullifier) whose Poseidon hash
    /// equals the on-chain commitment, without revealing secret or nullifier.
    ///
    /// nullifier_hash = sha256(nullifier_hex_string) as 32 bytes.
    /// It is stored after withdrawal to prevent double-spending the same key.
    ///
    /// On-chain proof verification is performed by the TierVerifier contract
    /// using Stellar Protocol 25 BN254 host functions.
    pub fn withdraw(
        env: Env,
        commitment: BytesN<32>,
        proof: Groth16Proof,
        nullifier_hash: BytesN<32>,
        recipient: Address,
    ) -> Result<(), PoolError> {
        // 1. Load deposit
        let record: DepositRecord = env
            .storage()
            .persistent()
            .get(&DataKey::Deposit(commitment.clone()))
            .ok_or(PoolError::CommitmentNotFound)?;

        // 2. Nullifier double-spend check
        if env
            .storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::NullifierUsed(nullifier_hash.clone()))
            .unwrap_or(false)
        {
            return Err(PoolError::NullifierAlreadySpent);
        }

        // 3. Verify Groth16 proof on-chain via TierVerifier.
        //
        //    Public inputs:
        //      [0] tier_id = amount as 32-byte big-endian U256
        //      [1] commitment_expected = the stored commitment
        //
        //    Private inputs (committed to by the proof, not revealed):
        //      address_hash = secret
        //      balance      = amount
        //      salt         = nullifier
        let verifier: Address = env
            .storage()
            .instance()
            .get(&DataKey::Verifier)
            .ok_or(PoolError::NotInitialized)?;

        let amount_bytes = Self::i128_to_bytes32(&env, record.amount);
        let mut public_inputs: Vec<BytesN<32>> = Vec::new(&env);
        public_inputs.push_back(amount_bytes);
        public_inputs.push_back(commitment.clone());

        let verifier_client = verifier::Client::new(&env, &verifier);
        verifier_client
            .try_verify_groth16(&public_inputs, &proof)
            .map_err(|_| PoolError::InvalidProof)?
            .map_err(|_| PoolError::InvalidProof)?;

        // 4. Mark nullifier spent
        let max_ttl = env.storage().max_ttl();
        env.storage()
            .persistent()
            .set(&DataKey::NullifierUsed(nullifier_hash.clone()), &true);
        env.storage().persistent().extend_ttl(
            &DataKey::NullifierUsed(nullifier_hash.clone()),
            max_ttl,
            max_ttl,
        );

        // 5. Release funds to recipient (specified by the prover, not the depositor)
        token::Client::new(&env, &record.token).transfer(
            &env.current_contract_address(),
            &recipient,
            &record.amount,
        );

        env.events().publish(
            (Symbol::new(&env, "Withdrawn"),),
            (
                commitment,
                recipient,
                nullifier_hash,
                record.amount,
                WITHDRAW_STATEMENT_VERSION,
            ),
        );

        Ok(())
    }

    // ========================================================================
    // Read-only
    // ========================================================================

    pub fn get_deposit(env: Env, commitment: BytesN<32>) -> Option<DepositRecord> {
        env.storage()
            .persistent()
            .get(&DataKey::Deposit(commitment))
    }

    pub fn is_nullifier_used(env: Env, nullifier_hash: BytesN<32>) -> bool {
        env.storage()
            .persistent()
            .get::<DataKey, bool>(&DataKey::NullifierUsed(nullifier_hash))
            .unwrap_or(false)
    }

    pub fn admin(env: Env) -> Result<Address, PoolError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(PoolError::NotInitialized)
    }

    pub fn verifier(env: Env) -> Result<Address, PoolError> {
        env.storage()
            .instance()
            .get(&DataKey::Verifier)
            .ok_or(PoolError::NotInitialized)
    }

    /// Version marker for the current withdraw statement schema.
    pub fn withdraw_statement_version(_env: Env) -> u32 {
        WITHDRAW_STATEMENT_VERSION
    }

    // ========================================================================
    // Internals
    // ========================================================================

    fn require_admin(env: &Env) -> Result<Address, PoolError> {
        env.storage()
            .instance()
            .get(&DataKey::Admin)
            .ok_or(PoolError::NotAdmin)
    }

    /// Encode an i128 as a 32-byte big-endian value (high 16 bytes = 0).
    pub fn i128_to_bytes32(env: &Env, value: i128) -> BytesN<32> {
        let mut arr = [0u8; 32];
        let be = value.to_be_bytes();
        arr[16..32].copy_from_slice(&be);
        BytesN::from_array(env, &arr)
    }
}

// ============================================================================
// Tests
// ============================================================================

#[cfg(test)]
mod test {
    use super::*;
    use soroban_sdk::testutils::{Address as _, Ledger};
    use soroban_sdk::token::StellarAssetClient;
    use soroban_sdk::Env;

    // -----------------------------------------------------------------------
    // Helpers
    // -----------------------------------------------------------------------

    fn create_token(env: &Env, admin: &Address) -> Address {
        let sac = env.register_stellar_asset_contract_v2(admin.clone());
        sac.address()
    }

    fn mint(env: &Env, token: &Address, to: &Address, amount: i128) {
        // Get admin from SAC — works because we own it
        let admin = Address::generate(env);
        // We need to use the StellarAssetClient; since admin changes each call we
        // just use mock_all_auths for convenience in tests.
        StellarAssetClient::new(env, token).mint(to, &amount);
    }

    /// Mock verifier: always returns Ok(true).
    #[contract]
    struct MockVerifier;

    #[contractimpl]
    impl MockVerifier {
        pub fn verify_groth16(
            _env: Env,
            _public_inputs: Vec<BytesN<32>>,
            _proof: verifier::Groth16Proof,
        ) -> bool {
            true
        }
    }

    /// Mock verifier: always panics (simulates invalid proof).
    #[contract]
    struct RejectVerifier;

    #[contractimpl]
    impl RejectVerifier {
        pub fn verify_groth16(
            _env: Env,
            _public_inputs: Vec<BytesN<32>>,
            _proof: verifier::Groth16Proof,
        ) -> bool {
            panic!("proof rejected")
        }
    }

    fn deploy_pool<'a>(env: &'a Env, admin: &Address, verifier_id: &Address) -> CommitmentPoolClient<'a> {
        let id = env.register(CommitmentPool, ());
        let client = CommitmentPoolClient::new(env, &id);
        client.initialize(admin, verifier_id);
        client
    }

    fn sample_commitment(env: &Env, seed: u8) -> BytesN<32> {
        let mut arr = [0u8; 32];
        arr[31] = seed;
        BytesN::from_array(env, &arr)
    }

    fn sample_proof(env: &Env) -> Groth16Proof {
        Groth16Proof {
            pi_a: BytesN::from_array(env, &[1u8; 64]),
            pi_b: BytesN::from_array(env, &[2u8; 128]),
            pi_c: BytesN::from_array(env, &[3u8; 64]),
        }
    }

    // -----------------------------------------------------------------------
    // Tests
    // -----------------------------------------------------------------------

    #[test]
    fn test_initialize() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let verifier_id = env.register(MockVerifier, ());
        let pool = deploy_pool(&env, &admin, &verifier_id);

        assert_eq!(pool.admin(), admin);
        assert_eq!(pool.verifier(), verifier_id);
    }

    #[test]
    fn test_initialize_twice_fails() {
        let env = Env::default();
        env.mock_all_auths();
        let admin = Address::generate(&env);
        let verifier_id = env.register(MockVerifier, ());
        let pool = deploy_pool(&env, &admin, &verifier_id);

        let res = pool.try_initialize(&admin, &verifier_id);
        assert!(res.is_err());
    }

    #[test]
    fn test_deposit_records_commitment() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_000_000);

        let admin = Address::generate(&env);
        let depositor = Address::generate(&env);
        let verifier_id = env.register(MockVerifier, ());
        let token = create_token(&env, &admin);
        let pool = deploy_pool(&env, &admin, &verifier_id);

        mint(&env, &token, &depositor, 1_000_000_000);

        let commitment = sample_commitment(&env, 0x01);
        pool.deposit(&depositor, &token, &100_000_000_i128, &commitment);

        let rec = pool.get_deposit(&commitment).expect("deposit should exist");
        assert_eq!(rec.amount, 100_000_000);
        assert_eq!(rec.token, token);
        assert_eq!(rec.depositor, depositor);
    }

    #[test]
    fn test_duplicate_commitment_rejected() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let depositor = Address::generate(&env);
        let verifier_id = env.register(MockVerifier, ());
        let token = create_token(&env, &admin);
        let pool = deploy_pool(&env, &admin, &verifier_id);

        mint(&env, &token, &depositor, 2_000_000_000);

        let commitment = sample_commitment(&env, 0x02);
        pool.deposit(&depositor, &token, &100_000_000_i128, &commitment);

        let res = pool.try_deposit(&depositor, &token, &100_000_000_i128, &commitment);
        assert!(res.is_err());
    }

    #[test]
    fn test_deposit_and_withdraw_full_flow() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_000_000);

        let admin = Address::generate(&env);
        let depositor = Address::generate(&env);
        let recipient = Address::generate(&env); // completely different address!
        let verifier_id = env.register(MockVerifier, ());
        let token = create_token(&env, &admin);
        let pool = deploy_pool(&env, &admin, &verifier_id);

        mint(&env, &token, &depositor, 1_000_000_000);

        let commitment = sample_commitment(&env, 0x03);
        let nullifier_hash = sample_commitment(&env, 0xAA);
        let amount: i128 = 250_000_000;

        pool.deposit(&depositor, &token, &amount, &commitment);

        // The KEY insight: recipient is different from depositor — unlinked!
        let proof = sample_proof(&env);
        pool.withdraw(&commitment, &proof, &nullifier_hash, &recipient);

        let token_client = token::Client::new(&env, &token);
        assert_eq!(token_client.balance(&recipient), amount);
        // depositor did not receive anything
        assert_eq!(token_client.balance(&depositor), 1_000_000_000 - amount);
    }

    #[test]
    fn test_double_spend_rejected() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let depositor = Address::generate(&env);
        let recipient = Address::generate(&env);
        let verifier_id = env.register(MockVerifier, ());
        let token = create_token(&env, &admin);
        let pool = deploy_pool(&env, &admin, &verifier_id);

        mint(&env, &token, &depositor, 1_000_000_000);

        let commitment = sample_commitment(&env, 0x04);
        let nullifier_hash = sample_commitment(&env, 0xBB);
        let proof = sample_proof(&env);

        pool.deposit(&depositor, &token, &100_000_000_i128, &commitment);
        pool.withdraw(&commitment, &proof, &nullifier_hash, &recipient);

        assert!(pool.is_nullifier_used(&nullifier_hash));

        // Same nullifier — must fail
        let res = pool.try_withdraw(&commitment, &proof, &nullifier_hash, &recipient);
        assert!(res.is_err());
    }

    #[test]
    fn test_invalid_proof_rejected() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let depositor = Address::generate(&env);
        let recipient = Address::generate(&env);
        let verifier_id = env.register(RejectVerifier, ());
        let token = create_token(&env, &admin);
        let pool = deploy_pool(&env, &admin, &verifier_id);

        mint(&env, &token, &depositor, 1_000_000_000);

        let commitment = sample_commitment(&env, 0x05);
        let nullifier_hash = sample_commitment(&env, 0xCC);
        let proof = sample_proof(&env);

        pool.deposit(&depositor, &token, &100_000_000_i128, &commitment);

        let res = pool.try_withdraw(&commitment, &proof, &nullifier_hash, &recipient);
        assert!(res.is_err());

        // Nullifier must NOT be marked used on failed withdrawal
        assert!(!pool.is_nullifier_used(&nullifier_hash));
    }

    #[test]
    fn test_withdraw_unknown_commitment_fails() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let recipient = Address::generate(&env);
        let verifier_id = env.register(MockVerifier, ());
        let pool = deploy_pool(&env, &admin, &verifier_id);

        let commitment = sample_commitment(&env, 0x06);
        let nullifier_hash = sample_commitment(&env, 0xDD);
        let proof = sample_proof(&env);

        let res = pool.try_withdraw(&commitment, &proof, &nullifier_hash, &recipient);
        assert!(res.is_err());
    }

    #[test]
    fn test_zero_amount_deposit_rejected() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let depositor = Address::generate(&env);
        let verifier_id = env.register(MockVerifier, ());
        let token = create_token(&env, &admin);
        let pool = deploy_pool(&env, &admin, &verifier_id);

        let commitment = sample_commitment(&env, 0x07);
        let res = pool.try_deposit(&depositor, &token, &0_i128, &commitment);
        assert!(res.is_err());
    }

    #[test]
    fn test_i128_to_bytes32_encoding() {
        let env = Env::default();

        // 1 stroop → last byte = 1, rest = 0
        let b = CommitmentPool::i128_to_bytes32(&env, 1);
        let arr = b.to_array();
        assert_eq!(arr[31], 1u8);
        for i in 0..31 {
            assert_eq!(arr[i], 0u8);
        }

        // 256 = 0x100 → arr[30]=1, arr[31]=0
        let b256 = CommitmentPool::i128_to_bytes32(&env, 256);
        let arr256 = b256.to_array();
        assert_eq!(arr256[30], 1u8);
        assert_eq!(arr256[31], 0u8);
    }

    // -----------------------------------------------------------------------
    // Admin / governance tests (Gate 5 — Auth)
    // -----------------------------------------------------------------------

    /// Admin can replace the verifier address. The new verifier is used for
    /// all subsequent withdrawals. This is a critical governance operation:
    /// once replaced, all pending withdrawal proofs must be valid under the
    /// new verifier's key. Audit note: verifier replacement is admin-only
    /// and must be disclosed to users — see docs/audits/discombobulator-pr117/THREAT_MODEL.md.
    #[test]
    fn test_admin_can_replace_verifier() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let verifier_a = env.register(MockVerifier, ());
        let verifier_b = env.register(MockVerifier, ());
        let pool = deploy_pool(&env, &admin, &verifier_a);

        assert_eq!(pool.verifier(), verifier_a);
        pool.set_verifier(&verifier_b);
        assert_eq!(pool.verifier(), verifier_b);
    }

    /// After the verifier is replaced with a reject-all verifier, all
    /// withdrawal proofs must fail — even for deposits made before the switch.
    /// This confirms that verifier replacement is an effective governance lever
    /// over all outstanding escrowed funds. Users must trust the admin.
    #[test]
    fn test_verifier_replacement_gates_future_withdrawals() {
        let env = Env::default();
        env.mock_all_auths();
        env.ledger().with_mut(|l| l.timestamp = 1_000_000);

        let admin = Address::generate(&env);
        let depositor = Address::generate(&env);
        let recipient = Address::generate(&env);
        let verifier_ok = env.register(MockVerifier, ());
        let verifier_reject = env.register(RejectVerifier, ());
        let token = create_token(&env, &admin);
        let pool = deploy_pool(&env, &admin, &verifier_ok);

        mint(&env, &token, &depositor, 1_000_000_000);

        let commitment = sample_commitment(&env, 0x08);
        let nullifier_hash = sample_commitment(&env, 0xEE);
        let proof = sample_proof(&env);

        pool.deposit(&depositor, &token, &100_000_000_i128, &commitment);

        // Admin replaces verifier with one that always rejects
        pool.set_verifier(&verifier_reject);

        // Withdrawal now fails — the escrowed deposit is frozen until
        // a valid verifier is restored (or the admin acts)
        let res = pool.try_withdraw(&commitment, &proof, &nullifier_hash, &recipient);
        assert!(res.is_err());

        // Nullifier must NOT be marked used when proof fails post-verifier-swap
        assert!(!pool.is_nullifier_used(&nullifier_hash));
    }

    /// withdraw_statement_version() exposes the current statement schema version
    /// so clients can detect version drift before submitting proofs.
    #[test]
    fn test_withdraw_statement_version_is_v1() {
        let env = Env::default();
        let pool_id = env.register(CommitmentPool, ());
        let pool = CommitmentPoolClient::new(&env, &pool_id);
        assert_eq!(pool.withdraw_statement_version(), 1u32);
    }

    /// Verifier is readable before and after replacement via the public
    /// `verifier()` read-only function — callers can detect governance changes.
    #[test]
    fn test_verifier_address_is_readable() {
        let env = Env::default();
        env.mock_all_auths();

        let admin = Address::generate(&env);
        let verifier_a = env.register(MockVerifier, ());
        let verifier_b = env.register(MockVerifier, ());
        let pool = deploy_pool(&env, &admin, &verifier_a);

        assert_eq!(pool.verifier(), verifier_a);
        pool.set_verifier(&verifier_b);
        assert_eq!(pool.verifier(), verifier_b);
        // admin unchanged
        assert_eq!(pool.admin(), admin);
    }
}
