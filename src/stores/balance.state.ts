/**
 * Pure balance state using Svelte 5 runes
 * No SDK dependencies.
 */

export const balanceState = $state<{
    balance: bigint | null;
    xlmBalance: bigint | null;
    loading: boolean;
    lastUpdated: Date | null;
    transactionLock: boolean; // Prevents concurrent balance updates during transactions
}>({
    balance: null,
    xlmBalance: null,
    loading: false,
    lastUpdated: null,
    transactionLock: false,
});

/**
 * Get current KALE balance (read-only accessor)
 */
export function getBalance(): bigint | null {
    return balanceState.balance;
}

/**
 * Get current XLM balance (read-only accessor)
 */
export function getXlmBalance(): bigint | null {
    return balanceState.xlmBalance;
}

/**
 * Check if balance is loading
 */
export function isBalanceLoading(): boolean {
    return balanceState.loading;
}
