import { config } from 'dotenv';
import { NetworkStreamer } from './streamer';

config();

async function main() {
  console.log("🚀 Starting Solana Smart Transaction Infrastructure Stack");
  
  // 1. Initialize Yellowstone gRPC client
  const endpoint = process.env.YELLOWSTONE_GRPC_ENDPOINT || '';
  const token = process.env.YELLOWSTONE_GRPC_TOKEN || '';
  
  const streamer = new NetworkStreamer(endpoint, token);
  await streamer.start();
  // TODO: Initialize Jito tip calculator
  // TODO: Initialize Transaction Engine
  // TODO: Start AI Operator
}

main().catch(error => {
  console.error("Fatal error during execution:", error);
  process.exit(1);
});
