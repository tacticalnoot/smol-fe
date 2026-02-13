
import {
    StellarWalletsKit,
    WalletNetwork,
    FreighterModule,
    xBullModule,
    AlbedoModule
} from '@creit.tech/stellar-wallets-kit';
import { SMOL_ID_MODULE } from './smol-id-module';

export const kit = new StellarWalletsKit({
    network: WalletNetwork.PUBLIC,
    selectedWalletId: "freighter",
    modules: [
        SMOL_ID_MODULE,
        new FreighterModule(),
        new xBullModule(),
        new AlbedoModule()
    ]
});
