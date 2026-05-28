import OpenAI from 'openai';
import { logger } from '../utils/logger';

export interface FailureContext {
    error: string;
    signature?: string;
    slot: number;
    tipAmount: number;
    blockhash: string;
}

export interface AgentDecision {
    action: 'REFRESH_BLOCKHASH' | 'INCREASE_TIP' | 'ABORT';
    tipAdjustmentFactor: number;
    reasoning: string;
}

export class AIOperator {
    private openai: OpenAI;

    constructor(apiKey: string) {
        if (!apiKey) {
            throw new Error("OPENAI_API_KEY is required in .env");
        }
        this.openai = new OpenAI({ apiKey });
        logger.info('AIOperator initialized');
    }

    /**
     * When a bundle fails, we pass the exact state here. 
     * The LLM acts as an autonomous systems engineer to diagnose and prescribe a fix.
     */
    public async evaluateFailure(context: FailureContext): Promise<AgentDecision> {
        logger.warn('AI Agent evaluating transaction failure...', { signature: context.signature, error: context.error });

        const prompt = `
        You are an autonomous Solana infrastructure agent. Your job is to rescue failed transactions.
        
        A Jito bundle just failed. Here is the exact system context:
        - Error Details: ${context.error}
        - Current Tip Amount: ${context.tipAmount} lamports
        - Submission Slot: ${context.slot}
        - Blockhash used: ${context.blockhash}
        
        Analyze the failure logically:
        1. If the error mentions "Blockhash not found", "expired", or implies age, your action MUST be "REFRESH_BLOCKHASH". You should also slightly bump the tip (e.g., 1.1) to ensure the retry lands faster.
        2. If the error mentions "insufficient funds" for fee, or "Fee too low", your action MUST be "INCREASE_TIP" (e.g., 1.5).
        3. If it's a fatal unrecoverable error, choose "ABORT".
        
        You must return ONLY a strictly valid JSON response matching this schema:
        {
            "action": "REFRESH_BLOCKHASH" | "INCREASE_TIP" | "ABORT",
            "tipAdjustmentFactor": number,
            "reasoning": "short explanation of your engineering decision"
        }
        `;

        try {
            const response = await this.openai.chat.completions.create({
                model: "gpt-4o-mini",
                messages: [{ role: "system", content: prompt }],
                response_format: { type: "json_object" },
                temperature: 0.2 // Low temperature for highly deterministic infrastructure decisions
            });

            const content = response.choices[0].message.content;
            if (!content) {
                throw new Error("Empty response from AI");
            }

            const decision: AgentDecision = JSON.parse(content);
            logger.info('AI Agent Decision Reached', { action: decision.action, reasoning: decision.reasoning });
            return decision;

        } catch (error: any) {
            logger.error('AI Operator failed to evaluate, triggering safe fallback', { error: error.message });
            // Fallback safe action
            return {
                action: 'ABORT',
                tipAdjustmentFactor: 1,
                reasoning: `Fallback triggered due to AI error: ${error.message}`
            };
        }
    }
}
