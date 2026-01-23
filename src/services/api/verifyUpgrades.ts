
import { StrKey } from '@stellar/stellar-sdk';
import { unlockUpgrade } from '../../stores/upgrades.svelte';
import { getVIPAccess } from '../../utils/vip';
import { findTransfersToRecipient } from '../../utils/horizon';

const ADMIN_ADDRESS = "CBNORBI4DCE7LIC42FWMCIWQRULWAUGF2MH2Z7X2RNTFAYNXIACJ33IM";
const SMOL_MART_AMOUNTS = {
    PREMIUM_HEADER: 100000,
    GOLDEN_KALE: 69420.67,
    SHOWCASE_REEL: 1000000,
    VIBE_MATRIX: 250000
};

/**
 * Scan account history to see if they already paid for upgrades.
 * This effectively "Restores Purchases" from the blockchain.
 */
export async function verifyPastPurchases(userAddress: string): Promise<void> {
    // Validate address is not empty or null
    if (!userAddress) return;

    // Validate address is a properly formatted Stellar contract address
    const trimmedAddress = userAddress.trim();
    if (!trimmedAddress) {
        console.warn('[SmolMart] Empty address provided to verifyPastPurchases');
        return;
    }

    // Validate it's a valid contract address (starts with C and proper format)
    if (!StrKey.isValidContract(trimmedAddress)) {
        console.warn('[SmolMart] Invalid contract address format:', trimmedAddress);
        return;
    }

    // VIP check - instant unlock for whitelisted addresses (granular)
    const vipAccess = getVIPAccess(trimmedAddress);
    if (vipAccess) {
        if (vipAccess.premiumHeader) unlockUpgrade('premiumHeader');
        if (vipAccess.goldenKale) unlockUpgrade('goldenKale');
        if (vipAccess.showcaseReel) unlockUpgrade('showcaseReel');
        if (vipAccess.vibeMatrix) unlockUpgrade('vibeMatrix');
        return;
    }

    try {
        // Scan for transfers to admin address with specific amounts
        const purchaseAmounts = [
            SMOL_MART_AMOUNTS.PREMIUM_HEADER,
            SMOL_MART_AMOUNTS.GOLDEN_KALE,
            SMOL_MART_AMOUNTS.SHOWCASE_REEL,
            SMOL_MART_AMOUNTS.VIBE_MATRIX
        ];

        const foundTransfers = await findTransfersToRecipient(
            trimmedAddress,
            ADMIN_ADDRESS,
            purchaseAmounts,
            {
                limit: 200,
                maxPages: 1 // Scan last 200 operations (can increase if needed)
            }
        );

        // Unlock upgrades based on found transfers
        if (foundTransfers.get(SMOL_MART_AMOUNTS.PREMIUM_HEADER)) {
            unlockUpgrade('premiumHeader');
        }

        if (foundTransfers.get(SMOL_MART_AMOUNTS.GOLDEN_KALE)) {
            unlockUpgrade('goldenKale');
        }

        if (foundTransfers.get(SMOL_MART_AMOUNTS.SHOWCASE_REEL)) {
            // Showcase Reel is the ultimate bundle - unlocks everything
            unlockUpgrade('showcaseReel');
            unlockUpgrade('premiumHeader');
            unlockUpgrade('goldenKale');
            unlockUpgrade('vibeMatrix');
        }

        if (foundTransfers.get(SMOL_MART_AMOUNTS.VIBE_MATRIX)) {
            unlockUpgrade('vibeMatrix');
        }
    } catch (err) {
        console.error('[SmolMart] Verification failed', err);
    }
}
