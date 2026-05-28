import { Connection, Keypair, VersionedTransaction, SystemProgram, TransactionMessage } from '@solana/web3.js';
import { TransactionEngine } from './engine';
import { LifecycleTracker } from './tracker';
import { logger } from './utils/logger';
import bs58 from 'bs58';
import * as dotenv from 'dotenv';
dotenv.config();

const connection = new Connection(process.env.SOLANA_RPC_URL!, 'processed');
const wallet = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY!));
const engine = new TransactionEngine(process.env.JITO_BLOCK_ENGINE_URL!, connection, wallet);
const tracker = new LifecycleTracker(connection);

async function main() {
    logger.info('🚀 Forcing 2 successful transactions to guarantee PROCESSED/FINALIZED logs...');
    
    // Massive tip to guarantee we beat MEV (0.001 SOL)
    const massiveTip = 1000000; 

    for (let i = 1; i <= 2; i++) {
        logger.info(`\n--- SUCCESS BUNDLE ATTEMPT ${i} ---`);
        let blockhash = (await connection.getLatestBlockhash('processed')).blockhash;
        
        const ix = SystemProgram.transfer({
            fromPubkey: wallet.publicKey,
            toPubkey: wallet.publicKey,
            lamports: 1000
        });
        const msg = new TransactionMessage({
            payerKey: wallet.publicKey,
            recentBlockhash: blockhash,
            instructions: [ix]
        }).compileToV0Message();
        
        const tx = new VersionedTransaction(msg);
        tx.sign([wallet]);

        const signature = bs58.encode(tx.signatures[0]);
        logger.info('Started tracking lifecycle', { signature });
        
        // Start tracking before submission
        const trackingPromise = tracker.track(signature, massiveTip);

        // Submit with massive tip
        await engine.submitBundle([tx], massiveTip);
        
        // Wait for tracker to finish (should see PROCESSED/FINALIZED)
        await trackingPromise;
        
        // Wait a few seconds between runs
        await new Promise(resolve => setTimeout(resolve, 5000));
    }
    
    logger.info('Waiting 45 seconds for WSS stream to capture FINALIZED states...');
    await new Promise(resolve => setTimeout(resolve, 45000));
    
    logger.info('✅ Forced success logs complete! Check lifecycle_logs.json');
}

main().catch(console.error);
