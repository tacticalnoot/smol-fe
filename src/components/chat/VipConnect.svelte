<script lang="ts">
    import { createEventDispatcher } from "svelte";
    import { kit } from "../../lib/the-vip/swk";

    const dispatch = createEventDispatcher();
    let isLoading = false;
    const SELECTION_POLL_MS = 100;
    const SELECTION_TIMEOUT_MS = 4000;
    const ADDRESS_RETRY_ATTEMPTS = 20;
    const ADDRESS_RETRY_DELAY_MS = 200;

    function sleep(ms: number) {
        return new Promise((resolve) => setTimeout(resolve, ms));
    }

    async function connect() {
        isLoading = true;
        try {
            let selectedWalletId = "";
            await kit.openModal({
                onWalletSelected: async (option) => {
                    selectedWalletId = option?.id || "";
                    if (selectedWalletId) {
                        kit.setWallet(selectedWalletId);
                    }
                },
            });

            if (!selectedWalletId) {
                const polls = Math.ceil(SELECTION_TIMEOUT_MS / SELECTION_POLL_MS);
                for (let i = 0; i < polls && !selectedWalletId; i += 1) {
                    await sleep(SELECTION_POLL_MS);
                }
            }

            if (!selectedWalletId) {
                throw new Error("No wallet selected");
            }

            kit.setWallet(selectedWalletId);

            for (let attempt = 0; attempt < ADDRESS_RETRY_ATTEMPTS; attempt += 1) {
                try {
                    const { address } = await kit.getAddress();
                    dispatch("connect", { publicKey: address });
                    return;
                } catch (err: any) {
                    const message = String(err?.message || "");
                    const isSetWalletRace = message
                        .toLowerCase()
                        .includes("set the wallet first");
                    if (!isSetWalletRace || attempt === ADDRESS_RETRY_ATTEMPTS - 1) {
                        throw err;
                    }
                }
                await sleep(ADDRESS_RETRY_DELAY_MS);
            }

            throw new Error("Wallet took too long to return an address");
        } catch (e) {
            console.error(e);
            dispatch("error", e);
        } finally {
            isLoading = false;
        }
    }
</script>

<button
    on:click={connect}
    disabled={isLoading}
    class="px-8 py-3 bg-white text-black font-bold rounded-full hover:bg-gray-200 transition-transform active:scale-95 disabled:opacity-50 disabled:cursor-wait"
>
    {isLoading ? "Connecting..." : "CONNECT WALLET"}
</button>
