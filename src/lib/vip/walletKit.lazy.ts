let kitPromise: Promise<{
  StellarWalletsKit: any;
  WalletNetwork: any;
}> | null = null;

export async function loadWalletKit() {
  if (kitPromise) return kitPromise;

  kitPromise = (async () => {
    const [{ StellarWalletsKit, WalletNetwork }, utils] = await Promise.all([
      import("@creit.tech/stellar-wallets-kit/sdk"),
      import("@creit.tech/stellar-wallets-kit/modules/utils"),
    ]);

    const modules =
      typeof utils.defaultModules === "function"
        ? utils.defaultModules()
        : utils.modules?.default?.() ?? [];

    StellarWalletsKit.init({
      modules,
      network: WalletNetwork.PUBLIC,
    });

    return { StellarWalletsKit, WalletNetwork };
  })();

  return kitPromise;
}
