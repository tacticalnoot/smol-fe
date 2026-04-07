# Project Notes

## DeFi Protocol Reference Transactions (for future Blend/PHO/AQUA integration)

These real mainnet transactions are saved as canonical examples for understanding
each protocol's on-chain mechanics when integrating them directly into the app.

### AQUA Bribe/Reward Payment
- TX: `6f9d6c64b9309a0091b5996fa29afcb47559fdeef98b4d68ef5483b2a016cab1`
- Type: Direct `payment` operation sending AQUA to the account (bribe for LP/voting)
- Key: These are regular payment ops, NOT claimable balances. Must track via payments stream.

### Blend Protocol — Backstop Emission
- TX: `8de2b26be22e9d5b33be37e8917711a70ae071195e43743719404761762fce97`
- Type: `invoke_host_function` — user called the Blend backstop contract
- BLND tokens are emitted as SAC transfers visible in `asset_balance_changes`
- Key: Track via ops stream `invoke_host_function` + `asset_balance_changes`

### Phoenix DEX — LP Withdrawal (with PHO reward)
- TX: `bdbdfdd40a2f0c253518b3b65968ebd850468a9b41e37f9251e168696174fcdf`
- Type: `invoke_host_function` — Phoenix LP withdraw returns LP assets + PHO rewards
- PHO appears as SAC transfer in `asset_balance_changes`
- Key: Track via ops stream `invoke_host_function` + `asset_balance_changes`

## Protocol Token Issuers (Stellar Mainnet)
- AQUA: `GBNZILSTVQZ4R7IKQDGHYGY2QXL5QOFJYQMXPKWRRM5PAV7Y4M67AQUA`
- BLND: `GDJEHTBE6ZHUXSWFI642DCGLUOECLHPF3KSXHPXTSTJ7E3JF6MQ5EZYY`
- PHO:  `GAX5TXB5RYJNLBUR477PEXM4X75APK2PGMTN6KEFQSESGWFXEAKFSXJO`
- USDC: `GA5ZSEJYB37JRC5AVCIA5MOP4RHTM335X2KGX3IHOJAPP5RE34K4KZVN`

## Aquarius Governance (AQUA Locker)
- Users lock AQUA tokens for governance voting power
- Locks held in Aquarius governance contract on Stellar/Soroban
- Governance API (best-effort): `https://governance.aqua.network/api/`
- Locks endpoint to try: `https://governance.aqua.network/api/locks/?address={address}`
