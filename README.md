# Smol - AI Music & ZK Gaming Lab ⚡

**Production**: [noot.smol.xyz](https://noot.smol.xyz) | **Hackathon Preview**: [smol-fe-7jl.pages.dev](https://smol-fe-7jl.pages.dev) | **Docs**: [Information Architecture](docs/INDEX.md)

Smol is a decentralized high-fidelity application powered by **Stellar Smart Contracts** and **Zero-Knowledge Proofs (ZK)**. It combines generative AI music with on-chain verifiable gaming mechanics.

## 🕹️ ZK Dungeon (Hackathon Mode)
Participating in the **DoraHacks Stellar Hacks: ZK Gaming** hackathon.
- **Verifiable Strategy**: Uses **Noir**, **RISC0**, and **Circom** to generate zero-knowledge proofs of local gameplay, verified on-chain via Stellar smart contracts.
- **Multilayered Privacy**: Players compete in a decentralized dungeon where every move is verified without exposing the underlying game state until settlement.
- **Hackathon MVP**: Includes a fully integrated Single-Player "Hackathon Mode" using the **Stellar Wallets Kit (Freighter)** on Testnet.

## 🏗️ Core Technology
- **Framework**: Astro `5.x` + Svelte `5.x` (Runes)
- **Styling**: Tailwind CSS `4.x` (Design-Tokens first)
- **Blockchain**: Stellar/Soroban (Mainnet via PasskeyKit, Testnet via SWK)
- **Cryptography**: Zero-Knowledge Proofs (Noir, RISC0, Circom)
- **Architecture**: Server-side Astro Proxy for bypassing CORS during decentralized relay syncing.

---

## 🚀 Getting Started

### Prerequisites
- **Node.js** (v22+)
- **pnpm** (v10+)
- **Stellar Wallets Kit** / Freighter (for Testnet Labs)

### Installation
1. `git clone <repo>`
2. `pnpm install`
3. `pnpm dev`

### Environment
Copy `.env.example` to `.env`. For Hackathon testing on Testnet, ensure `PUBLIC_NETWORK_PASSPHRASE` is set to the Testnet string.

---

## 🛡️ Repository Governance
This repository follows a **Fail-Closed** documentation policy. All technical facts are governed by the **[STATE OF WORLD](docs/STATE_OF_WORLD.md)**.

- **Human Onboarding**: [START HERE](docs/START_HERE.md)
- **AI Agent Protocol**: [AGENTS.md](docs/AGENTS.md)
- **Verification Suite**: [TESTING.md](docs/TESTING.md)

## 🤝 Contributing
We prioritize **Velocity & Trust**. Please read our **[CONTRIBUTING.md](CONTRIBUTING.md)** and **[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md)** before opening a PR.

## 🔒 Security
Security is paramount, especially regarding ZK G2 point serialization and Passkey signatures. See **[SECURITY.md](SECURITY.md)** for reporting vulnerabilities.

*Built on Stellar. Secured by ZK.*
