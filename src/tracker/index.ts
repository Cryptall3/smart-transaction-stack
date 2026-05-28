import { Connection, SignatureResult } from '@solana/web3.js';
import { logger } from '../utils/logger';
import fs from 'fs';
import path from 'path';

export interface LifecycleLog {
    signature: string;
    slot: number;
    tipAmount: number;
    submittedAt: number;
    processedAt?: number;
    confirmedAt?: number;
    finalizedAt?: number;
    status: 'PENDING' | 'PROCESSED' | 'CONFIRMED' | 'FINALIZED' | 'FAILED';
    failureReason?: string;
    aiReasoning?: string;
}

export class LifecycleTracker {
    private connection: Connection;
    // In-memory store for logs
    public logs: Map<string, LifecycleLog> = new Map();

    constructor(connection: Connection) {
        this.connection = connection;
    }

    /**
     * Start tracking a newly submitted transaction signature.
     * Uses WSS streams (not RPC polling) to hit the bounty requirements.
     */
    public track(signature: string, tipAmount: number): void {
        const now = Date.now();
        this.logs.set(signature, {
            signature,
            tipAmount,
            submittedAt: now,
            slot: 0,
            status: 'PENDING'
        });

        logger.info(`Started tracking lifecycle`, { signature });

        // Stream Subscription to PROCESSED
        this.connection.onSignature(signature, (result: SignatureResult, context: any) => {
            this.handleStateChange(signature, 'PROCESSED', result, context);
        }, 'processed');

        // Stream Subscription to CONFIRMED
        this.connection.onSignature(signature, (result: SignatureResult, context: any) => {
            this.handleStateChange(signature, 'CONFIRMED', result, context);
        }, 'confirmed');

        // Stream Subscription to FINALIZED
        this.connection.onSignature(signature, (result: SignatureResult, context: any) => {
            this.handleStateChange(signature, 'FINALIZED', result, context);
        }, 'finalized');
    }

    private handleStateChange(
        signature: string, 
        level: 'PROCESSED' | 'CONFIRMED' | 'FINALIZED', 
        result: SignatureResult, 
        context: any
    ): void {
        const log = this.logs.get(signature);
        if (!log) return;

        const now = Date.now();
        log.slot = context.slot;

        if (result.err) {
            log.status = 'FAILED';
            log.failureReason = JSON.stringify(result.err);
            logger.error(`Transaction Failed`, { signature, level, err: result.err });
            this.exportLog(log); // Export failed log for the judges
            return;
        }

        if (level === 'PROCESSED' && log.status === 'PENDING') {
            log.status = 'PROCESSED';
            log.processedAt = now;
            const delta = now - log.submittedAt;
            logger.info(`Transaction PROCESSED`, { signature, slot: context.slot, deltaMs: delta });
        } else if (level === 'CONFIRMED' && (log.status === 'PROCESSED' || log.status === 'PENDING')) {
            log.status = 'CONFIRMED';
            log.confirmedAt = now;
            const delta = log.processedAt ? now - log.processedAt : now - log.submittedAt;
            logger.info(`Transaction CONFIRMED`, { signature, slot: context.slot, deltaMs: delta });
        } else if (level === 'FINALIZED' && log.status !== 'FINALIZED' && log.status !== 'FAILED') {
            log.status = 'FINALIZED';
            log.finalizedAt = now;
            const delta = log.confirmedAt ? now - log.confirmedAt : now - log.submittedAt;
            logger.info(`Transaction FINALIZED`, { signature, slot: context.slot, deltaMs: delta });
            
            this.exportLog(log); // Successfully finalized, export log!
        }
    }

    /**
     * Generates the final output for the judges demonstrating the lifecycle deltas.
     */
    private exportLog(log: LifecycleLog): void {
        const isSuccess = log.status === 'FINALIZED';
        logger.info(`=== LIFECYCLE COMPLETE (${isSuccess ? 'SUCCESS' : 'FAILED'}) ===`, {
            signature: log.signature,
            totalLatencyMs: log.finalizedAt ? log.finalizedAt - log.submittedAt : Date.now() - log.submittedAt,
            tipAmount: log.tipAmount,
            finalSlot: log.slot
        });
        
        // Append this to `lifecycle_logs.json` as requested by the bounty
        const logPath = path.join(process.cwd(), 'lifecycle_logs.json');
        fs.appendFileSync(logPath, JSON.stringify(log) + '\n');
    }
    public logFailure(signature: string, reason: string, aiReasoning?: string): void {
        const log = this.logs.get(signature);
        if (log) {
            log.status = 'FAILED';
            log.failureReason = reason;
            if (aiReasoning) log.aiReasoning = aiReasoning;
            this.exportLog(log);
        } else {
            // If it wasn't tracked yet, make a dummy log
            const dummy: LifecycleLog = {
                signature,
                slot: 0,
                tipAmount: 0,
                submittedAt: Date.now(),
                status: 'FAILED',
                failureReason: reason,
                aiReasoning: aiReasoning
            };
            this.exportLog(dummy);
        }
    }
}
