# ⚡ Smart Transaction Stack (Solana AI Infrastructure)

A high-performance, modular, and autonomous transaction infrastructure stack for Solana. This system integrates real-time gRPC streaming (Yellowstone), optimized Jito bundle submission, non-polling WebSocket lifecycle tracking, and an AI-driven fault recovery operator to autonomously guarantee transaction landing.

## 🔗 Architecture Document
> **Note to Judges:** As per the bounty requirements, the full system architecture, data flow diagrams, and failure handling strategies are hosted publicly here:
> **[Architecture & System Data Flow Document](https://app.notion.com/p/36eb11c673fb8009ba76c272acc38d41?source=copy_link)**

## 🚀 Setup Instructions

1. **Clone & Install Dependencies:**
   ```bash
   git clone https://github.com/Cryptall3/smart-transaction-stack.git
   cd smart-transaction-stack
   pnpm install
   ```
2. **Environment Configuration:**
   Copy the example config and populate your keys:
   ```bash
   cp .env.example .env
   ```
   *Requires a base58 `PRIVATE_KEY`, your SolInfra `YELLOWSTONE_GRPC_ENDPOINT`, and an `OPENAI_API_KEY`.*
3. **Run the Autonomous Engine:**
   ```bash
   pnpm start
   ```

## 🧠 Bounty Questions & Real-World Observations

### 1. What does the delta between `processed_at` and `confirmed_at` tell you about network health at the time of submission?
The delta between `processed` (the moment the leader ingests the transaction into a block and state is mutated locally) and `confirmed` (the moment 66%+ of the network's active stake has voted on that block) is a direct barometer for **validator consensus health**. 

Under optimal conditions, this delta is roughly 400ms to 800ms (1-2 slots). If we observe this delta spiking to several seconds, it indicates one of three things:
1. **Vote Transaction Congestion:** Validators are struggling to land their vote transactions on-chain due to heavy localized spam.
2. **Network Partitioning/Forking:** The network is experiencing heavy micro-forking, forcing validators to spend extra time resolving the heaviest chain before committing their votes.
3. **Hardware Degradation:** A significant percentage of stake is running on degraded hardware, slowing down signature verification and vote propagation.

### 2. Why should you never use `finalized` commitment when fetching a blockhash for a time-sensitive transaction?
A Solana blockhash is valid for exactly **150 slots** (approximately 60 seconds under ideal 400ms block times). 

Achieving `finalized` commitment requires a block to be buried under 32+ subsequent blocks (MAX_LOCKOUT_HISTORY), which takes roughly 13 to 15 seconds. If you fetch a blockhash using `finalized` commitment, you are fetching a blockhash that is *already* 15 seconds old. You have instantly burned 25% of your transaction's lifespan before even signing it.

In high-congestion environments where block times drift closer to 600-800ms, a `finalized` blockhash might be dangerously close to expiration by the time it reaches the TPU. Always fetch blockhashes using `processed` or `confirmed` to maximize the valid lifespan of your bundle.

### 3. What happens to your bundle if the Jito leader skips their slot?
If the scheduled Jito leader skips their slot (due to a crash, network partition, or missing the slot window), **your bundle is effectively dead.** 

Jito bundles are not propagated through standard gossip like normal transactions; they are sent directly to the Jito Block Engine, which forwards them exclusively to the specific Jito validator scheduled for that epoch. If that leader skips, the bundle is dropped. It is not passed to the next leader. 

Our system observes this exact behavior: if the WebSocket stream does not detect a `processed` signature within a designated timeout window, our system classifies the bundle as dropped. The `AIOperator` is then invoked, which autonomously refreshes the blockhash and aggressively ramps up the tip multiplier to target the *next* available Jito leader in the schedule.