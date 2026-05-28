const { searcherClient } = require('jito-ts/dist/sdk/block-engine/searcher');

async function main() {
    try {
        const searcher = searcherClient('mainnet.block-engine.jito.wtf', undefined);
        const accounts = await searcher.getTipAccounts();
        console.log("Active Jito Tip Accounts:");
        console.log(accounts);
    } catch (e) {
        console.error(e);
    }
}
main();
