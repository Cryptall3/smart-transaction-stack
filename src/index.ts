import { config } from 'dotenv';
import { Connection, Keypair, SystemProgram, TransactionMessage, VersionedTransaction } from '@solana/web3.js';
import bs58 from 'bs58';
import { NetworkStreamer } from './streamer';
import { TransactionEngine, BundleSubmissionError } from './engine';
import { LifecycleTracker } from './tracker';
import { AIOperator } from './ai';
import { logger } from './utils/logger';

// Load environment variables
config();

async function sleep(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function runDemo() {
    logger.info('Starting Solana Smart Transaction Stack...');

    // 1. Load Configurations
    const rpcUrl = process.env.SOLANA_RPC_URL;
    const jitoEngineUrl = process.env.JITO_BLOCK_ENGINE_URL;
    const openaiKey = process.env.OPENAI_API_KEY;
    const privateKeyStr = process.env.PRIVATE_KEY;
    const yellowstoneUrl = process.env.YELLOWSTONE_GRPC_ENDPOINT || '';
    const yellowstoneToken = process.env.YELLOWSTONE_GRPC_TOKEN || '';

    if (!rpcUrl || !jitoEngineUrl || !openaiKey || !privateKeyStr) {
        logger.error('Missing required environment variables. Please check your .env file.');
        process.exit(1);
    }

    // Initialize Wallet
    let wallet: Keypair;
    try {
        wallet = Keypair.fromSecretKey(bs58.decode(privateKeyStr));
        logger.info(`Wallet loaded successfully: ${wallet.publicKey.toBase58()}`);
    } catch (e) {
        logger.error('Invalid PRIVATE_KEY format. Must be base58 string.');
        process.exit(1);
    }

    const connection = new Connection(rpcUrl, 'confirmed');

    // 2. Initialize Core Components
    const streamer = new NetworkStreamer(yellowstoneUrl, yellowstoneToken);
    const engine = new TransactionEngine(jitoEngineUrl, connection, wallet);
    const tracker = new LifecycleTracker(connection);
    const ai = new AIOperator(openaiKey);

    // 3. Connect to Yellowstone 
    try {
        await streamer.start();
        // Wire the streamer to the tip calculator
        (streamer as any).onTipUpdate = (percentile: number) => {
            engine.updateTipState(percentile);
        };
    } catch (e) {
        logger.warn('Streamer could not connect (likely SolInfra tier restriction). Proceeding with fallback mode.');
        // Fallback: Simulate the tip stream polling
        setInterval(() => {
            const mockPercentile = Math.floor(Math.random() * 50000) + 20000;
            engine.updateTipState(mockPercentile);
        }, 1000);
    }

    // 4. Generate the 10-Submission Lifecycle Log 
    logger.info('Starting 10-submission batch to generate lifecycle logs...');

    for (let i = 1; i <= 10; i++) {
        logger.info(`\n======================================================`);
        logger.info(`🚀 INITIATING SUBMISSION ${i} OF 10`);
        logger.info(`======================================================`);

        let attempt = 1;
        const maxAttempts = 5; 
        
        // Calculate dynamic tip based on the live stream state
        let currentTip = engine.calculateDynamicTip({ baseFee: 10000, multiplier: 1.5, maxTip: 200000 });
        
        let blockhash = (await connection.getLatestBlockhash('processed')).blockhash;

        while (attempt <= maxAttempts) {
            logger.info(`--- BUNDLE ATTEMPT ${attempt} ---`);
            let signature = "";
            
            try {
                // Construct a simple self-transfer
                const ix = SystemProgram.transfer({
                    fromPubkey: wallet.publicKey,
                    toPubkey: wallet.publicKey,
                    lamports: 1000 // 0.000001 SOL
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
                // For submissions #4 and #7 on their first attempt, we simulate an expired blockhash.
                if ((i === 4 || i === 7) && attempt === 1) {
                    logger.warn('⚠️ [FAULT INJECTION] Simulating blockhash expiry at RPC level...');
                    throw new BundleSubmissionError("Bundle dropped by Jito Block Engine. The tip was likely too low or the blockhash expired.");
                }

                // Submit via Jito Engine
                await engine.submitBundle([tx], currentTip);

                // Wait 15 seconds to observe the lifecycle logs
                logger.info('Waiting 15s for Jito leader to process bundle...');
                await sleep(15000);

                // Verify if it actually landed
                const status = await connection.getSignatureStatus(signature);
                if (!status || !status.value) {
                    // Jito might drop it if tip is too low or blockhash expired
                    throw new BundleSubmissionError("Bundle dropped by Jito Block Engine. The tip was likely too low or the blockhash expired.");
                }

                logger.info(`Submission ${i} landed successfully.`);
                break;

            } catch (error: any) {
                const errorMessage = error instanceof BundleSubmissionError ? error.message : "Unknown Error: " + error.message;
                tracker.logFailure(signature, errorMessage);

                // 5. Trigger Autonomous AI Recovery
                const decision = await ai.evaluateFailure({
                    error: errorMessage,
                    slot: 0, 
                    tipAmount: currentTip,
                    blockhash: blockhash
                });

                if (decision.action === 'ABORT') {
                    logger.error('AI Operator ordered an abort.', { reason: decision.reasoning });
                    break;
                } else if (decision.action === 'REFRESH_BLOCKHASH') {
                    logger.info('🤖 AI Action: Refreshing Blockhash', { reason: decision.reasoning });
                    blockhash = (await connection.getLatestBlockhash('processed')).blockhash;
                    currentTip = Math.floor(currentTip * decision.tipAdjustmentFactor);
                } else if (decision.action === 'INCREASE_TIP') {
                    logger.info('🤖 AI Action: Increasing Tip', { reason: decision.reasoning });
                    currentTip = Math.floor(currentTip * decision.tipAdjustmentFactor);
                }
                
                attempt++;
                await sleep(2000); // Backoff before retry
            }
        }

        // Delay to allow WS tracker to finish capturing FINALIZED state
        await sleep(20000); 
    }

    logger.info('✅ 10-Submission Loop Complete! Check lifecycle_logs.json');
}

runDemo().catch(console.error);
