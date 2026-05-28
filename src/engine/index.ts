import { Keypair, Connection, VersionedTransaction, PublicKey } from '@solana/web3.js';
import { searcherClient } from 'jito-ts/dist/sdk/block-engine/searcher';
import { Bundle } from 'jito-ts/dist/sdk/block-engine/types';
import { logger } from '../utils/logger';

export interface DynamicTipConfig {
    baseFee: number;
    multiplier: number;
    maxTip: number;
}

export class BundleSubmissionError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'BundleSubmissionError';
    }
}

export class TransactionEngine {
    private searcher: any; // ReturnType<typeof searcherClient>
    private connection: Connection;
    private wallet: Keypair;
    
    // We maintain a rolling state of the network's tip percentiles.
    // In a real system, this is constantly updated by the gRPC stream.
    private currentTipPercentile50th: number = 0;

    constructor(
        blockEngineUrl: string, 
        connection: Connection,
        wallet: Keypair
    ) {
        if (!blockEngineUrl) {
            throw new Error("Jito Block Engine URL is required");
        }
        this.connection = connection;
        this.wallet = wallet;
        
        // Initialize the Jito Searcher Client
        this.searcher = searcherClient(blockEngineUrl, undefined);
        logger.info('TransactionEngine initialized with Jito Searcher Client', { endpoint: blockEngineUrl });
    }

    /**
     * Ingests live tip data from the gRPC stream to keep our tip calculations accurate.
     */
    public updateTipState(percentile50th: number): void {
        this.currentTipPercentile50th = percentile50th;
    }

    /**
     * Calculates the dynamic tip using live network data, ensuring we don't overpay 
     * but still remain competitive enough to guarantee landing.
     */
    public calculateDynamicTip(config: DynamicTipConfig): number {
        const calculated = Math.floor(this.currentTipPercentile50th * config.multiplier) + config.baseFee;
        const finalTip = Math.min(calculated, config.maxTip);
        
        logger.info('Dynamic tip calculated', { 
            base: config.baseFee, 
            percentile: this.currentTipPercentile50th, 
            final: finalTip 
        });
        
        return finalTip;
    }

    /**
     * Constructs and submits a Jito Bundle containing the target transactions.
     */
    public async submitBundle(
        transactions: VersionedTransaction[], 
        tipAmount: number
    ): Promise<string> {
        try {
            // 1. Fetch latest blockhash (CRITICAL: Do NOT use 'finalized' for time-sensitive bundles)
            // Using 'processed' or 'confirmed' reduces latency and blockhash expiry risks.
            const { blockhash } = await this.connection.getLatestBlockhash('processed');

            // 2. Wrap transactions in a Jito Bundle
            const bundle = new Bundle(transactions, 5); // 5 is the max number of transactions in a bundle

            // 3. Add the tip instruction to the bundle
            // The tip account must be a valid Jito tip account PublicKey.
            // In a production system, this is selected randomly from Jito's list of 8 accounts to avoid bottlenecks.
            const tipAccount = new PublicKey('96gYZGLnJYVFmbjzopPSU6QiEV5fGqZNyN9nmNhvrZU5');
            bundle.addTipTx(this.wallet, tipAmount, tipAccount, blockhash);

            // 4. Send the bundle to the Block Engine
            logger.info('Submitting bundle to Jito Block Engine...', { 
                txCount: transactions.length, 
                tip: tipAmount 
            });

            // The Jito client returns the bundle UUID
            const bundleUuid = await this.searcher.sendBundle(bundle);
            logger.info('Bundle successfully dispatched', { uuid: bundleUuid });

            return bundleUuid;

        } catch (error: any) {
            logger.error('Failed to submit Jito bundle', { error: error.message });
            throw new BundleSubmissionError(error.message);
        }
    }
}
