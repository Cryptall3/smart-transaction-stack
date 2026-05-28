import Client, { CommitmentLevel } from '@triton-one/yellowstone-grpc';

export class NetworkStreamer {
  private client: Client;

  constructor(endpoint: string, token: string) {
    if (!endpoint) {
        throw new Error("YELLOWSTONE_GRPC_ENDPOINT is missing. Please set it in .env");
    }
    this.client = new Client(endpoint, token, undefined);
  }

  public async start() {
    console.log(`[Streamer] Connecting to Yellowstone gRPC...`);
    
    try {
        // If the library version requires an explicit connect, we call it
        if (typeof (this.client as any).connect === 'function') {
            await (this.client as any).connect();
        }
        
        const version = await this.client.getVersion();
        console.log(`[Streamer] Connected! Node Version: ${version.version}`);
    } catch (e: any) {
        console.error(`[Streamer] Failed to connect. Did you add your Endpoint and Token to .env?`);
        throw e;
    }

    // Subscribe to slots to maintain the current block schedule
    const stream = await this.client.subscribe();
    
    stream.on('data', (data) => {
      if (data.slot) {
        // Just logging every 10th slot so we don't spam the terminal too hard during testing
        if (Number(data.slot.slot) % 10 === 0) {
            console.log(`[Streamer] 🧱 New Slot Processed: ${data.slot.slot}`);
        }
      }
    });

    stream.on('error', (error) => {
      console.error(`[Streamer] Stream Error:`, error);
    });

    stream.on('end', () => {
      console.log(`[Streamer] Stream Ended`);
    });

    // Request the subscriptions
    await new Promise<void>((resolve, reject) => {
      stream.write({
        slots: {
          slotSub: {
            filterByCommitment: true
          }
        },
        accounts: {},
        transactions: {},
        blocks: {},
        blocksMeta: {},
        entry: {},
        commitment: CommitmentLevel.PROCESSED,
        accountsDataSlice: [],
        ping: undefined
      }, (err: any) => {
        if (err) {
          reject(err);
        } else {
          resolve();
        }
      });
    });

    console.log(`[Streamer] Subscribed to live Slot updates.`);
  }
}
