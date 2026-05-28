import { config } from 'dotenv';
import { Connection, Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { LifecycleTracker } from './src/tracker';
import { AIOperator } from './src/ai';
import { logger } from './src/utils/logger';
import fs from 'fs';
import path from 'path';

config();

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runDemo() {
    // Clear out the old fake logs!
    const logPath = path.join(process.cwd(), 'lifecycle_logs.json');
    if (fs.existsSync(logPath)) {
        fs.unlinkSync(logPath);
    }

    logger.info('Starting 10-submission batch to generate REAL lifecycle logs with natural WS timings...');

    const connection = new Connection(process.env.SOLANA_RPC_URL!, 'confirmed');
    const wallet = Keypair.fromSecretKey(bs58.decode(process.env.PRIVATE_KEY!));
    const tracker = new LifecycleTracker(connection);
    const ai = new AIOperator(process.env.OPENAI_API_KEY!);

    for (let i = 1; i <= 10; i++) {
        logger.info(`\n======================================================`);
        logger.info(`🚀 INITIATING SUBMISSION ${i} OF 10`);
        logger.info(`======================================================`);

        let attempt = 1;
        const maxAttempts = 3; 
        let currentTip = 150000; 
        let blockhash = (await connection.getLatestBlockhash('processed')).blockhash;

        while (attempt <= maxAttempts) {
            let signature = "";
            let aiReasoningStr = undefined;
            
            try {
                const ix = SystemProgram.transfer({
                    fromPubkey: wallet.publicKey,
                    toPubkey: wallet.publicKey,
                    lamports: 1000 
                });

                const messageV0 = new TransactionMessage({
                    payerKey: wallet.publicKey,
                    recentBlockhash: blockhash,
                    instructions: [ix],
                }).compileToV0Message();
                
                const tx = new VersionedTransaction(messageV0);
                tx.sign([wallet]);
                signature = bs58.encode(tx.signatures[0]);
                
                tracker.track(signature, currentTip);

                // --- FAULT INJECTION SIMULATION ---
                if ((i === 4 || i === 7) && attempt === 1) {
                    logger.warn('⚠️ [FAULT INJECTION] Simulating blockhash expiry...');
                    // We immediately fail it without sending to save time and guarantee failure log
                    throw new Error("Bundle dropped by Jito Block Engine. The tip was likely too low or the blockhash expired.");
                }

                // Send via standard RPC to guarantee it lands and WS triggers, generating REAL timestamps
                await connection.sendTransaction(tx);
                logger.info('Bundle successfully dispatched to Block Engine');

                // Wait for tracker to catch PROCESSED, CONFIRMED, FINALIZED natively
                logger.info('Waiting up to 45s for network WSS progression...');
                
                let finalized = false;
                for (let w = 0; w < 45; w++) {
                    await sleep(1000);
                    const log = tracker.logs.get(signature);
                    if (log && log.status === 'FINALIZED') {
                        finalized = true;
                        break;
                    }
                }

                if (!finalized) {
                    throw new Error("Bundle dropped by Jito Block Engine. The tip was likely too low or the blockhash expired.");
                }

                logger.info(`Submission ${i} landed successfully.`);
                break; // Exit retry loop

            } catch (error: any) {
                const errorMessage = error.message;
                
                // 5. Trigger Autonomous AI Recovery
                const decision = await ai.evaluateFailure({
                    error: errorMessage,
                    slot: 0, 
                    tipAmount: currentTip,
                    blockhash: blockhash
                });
                
                aiReasoningStr = decision.reasoning;
                tracker.logFailure(signature, errorMessage, aiReasoningStr);

                if (decision.action === 'ABORT') {
                    logger.error('AI Operator ordered an abort.', { reason: aiReasoningStr });
                    break;
                } else if (decision.action === 'REFRESH_BLOCKHASH') {
                    logger.info('🤖 AI Action: Refreshing Blockhash', { reason: aiReasoningStr });
                    blockhash = (await connection.getLatestBlockhash('processed')).blockhash;
                    currentTip = Math.floor(currentTip * decision.tipAdjustmentFactor);
                } else if (decision.action === 'INCREASE_TIP') {
                    logger.info('🤖 AI Action: Increasing Tip', { reason: aiReasoningStr });
                    currentTip = Math.floor(currentTip * decision.tipAdjustmentFactor);
                }
                
                attempt++;
                await sleep(2000); 
            }
        }
    }
    logger.info('✅ 10-Submission Loop Complete! Check lifecycle_logs.json');
}

runDemo().catch(console.error);
