import { Address } from 'viem';

type MinimalPublicClient = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getTransactionCount: (args: { address: Address; blockTag: any }) => Promise<number>;
};

/**
 * Per-wallet nonce manager that serializes transaction signing.
 *
 * Each caller wallet gets its own queue so concurrent requests across wallets
 * proceed in parallel, while requests sharing a wallet are strictly ordered.
 *
 * On first use (or after a reset) the nonce is fetched from the chain.
 * Subsequent transactions increment in-memory, avoiding RPC round-trips.
 * If a send fails with a nonce-related error, the manager resyncs from chain.
 */

type QueueEntry = {
  resolve: (nonce: number) => void;
  reject: (err: Error) => void;
};

class WalletNonceQueue {
  private currentNonce: number | null = null;
  private queue: QueueEntry[] = [];
  private processing = false;

  constructor(
    private readonly walletAddress: Address,
    private readonly publicClient: MinimalPublicClient
  ) {}

  async acquireNonce(): Promise<number> {
    return new Promise<number>((resolve, reject) => {
      this.queue.push({ resolve, reject });
      this.processQueue();
    });
  }

  commitNonce(): void {
    if (this.currentNonce !== null) {
      this.currentNonce += 1;
    }
    this.processing = false;
    this.processQueue();
  }

  rollbackAndResync(): void {
    this.currentNonce = null;
    this.processing = false;
    this.processQueue();
  }

  private async processQueue(): Promise<void> {
    if (this.processing || this.queue.length === 0) return;
    this.processing = true;

    const entry = this.queue.shift()!;

    try {
      if (this.currentNonce === null) {
        const onChain = await this.publicClient.getTransactionCount({
          address: this.walletAddress,
          blockTag: 'pending',
        });
        this.currentNonce = onChain;
      }
      entry.resolve(this.currentNonce);
    } catch (err) {
      this.processing = false;
      entry.reject(err instanceof Error ? err : new Error(String(err)));
      this.processQueue();
    }
  }
}

const queues = new Map<Address, WalletNonceQueue>();

export function getNonceQueue(walletAddress: Address, publicClient: MinimalPublicClient): WalletNonceQueue {
  let q = queues.get(walletAddress);
  if (!q) {
    q = new WalletNonceQueue(walletAddress, publicClient);
    queues.set(walletAddress, q);
  }
  return q;
}
