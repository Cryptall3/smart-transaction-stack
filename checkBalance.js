const { Connection, PublicKey } = require('@solana/web3.js');
require('dotenv').config();
async function main() {
    const conn = new Connection(process.env.SOLANA_RPC_URL);
    const balance = await conn.getBalance(new PublicKey('Dsyevk5tp4aqvQAqiUJNGacZMHFi1cJqd7G5uv6Kxj6Y'));
    console.log("Balance in SOL:", balance / 1e9);
}
main();
