import { randomBytes } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { Address, Hex, createPublicClient, createWalletClient, encodeFunctionData, http } from 'viem';
import { base } from 'viem/chains';
import { abis } from '@/lib/web3/constants/abis';
import { addresses } from '@/lib/web3/constants/addresses';
import { getNonceQueue } from './nonceManager';

let nextCallerIndex = 0;

const rpcUrl = process.env.BASE_RPC_URL;
const transport = http(rpcUrl && rpcUrl.length > 0 ? rpcUrl : undefined);

const publicClient = createPublicClient({ chain: base, transport });

function readEnvPrivateKey(keyName: 'PRIVATE_WALLET_CALLER_1' | 'PRIVATE_WALLET_CALLER_2'): Hex {
  const key = process.env[keyName];
  if (!key) {
    throw new Error(`Missing required env var: ${keyName}`);
  }
  if (!key.startsWith('0x')) {
    throw new Error(`Invalid ${keyName}: must start with 0x`);
  }
  if (key.length !== 66) {
    throw new Error(`Invalid ${keyName}: expected 32-byte hex private key`);
  }
  return key as Hex;
}

function buildCallerClients() {
  const privateKeys = [
    readEnvPrivateKey('PRIVATE_WALLET_CALLER_1'),
    readEnvPrivateKey('PRIVATE_WALLET_CALLER_2'),
  ];

  return privateKeys.map((pk) => {
    const account = privateKeyToAccount(pk);
    const walletClient = createWalletClient({
      account,
      chain: base,
      transport,
    });
    return { account, walletClient };
  });
}

const callerClients = buildCallerClients();

function getNextCaller() {
  const caller = callerClients[nextCallerIndex % callerClients.length];
  nextCallerIndex += 1;
  return caller;
}

function buildSeed(): bigint {
  return BigInt(`0x${randomBytes(32).toString('hex')}`);
}

const GAS_FLOOR: Record<string, bigint> = {
  playGameDelegated: 400_000n,
  settleBet: 200_000n,
  default: 500_000n,
};

async function estimateGasWithBuffer(
  account: { address: Address },
  to: Address,
  data: Hex,
  gasFloorKey: keyof typeof GAS_FLOOR = 'default'
): Promise<bigint> {
  try {
    const estimate = await publicClient.estimateGas({ account: account.address, to, data });
    return (estimate * 200n) / 100n;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    if (
      message.includes('revert') ||
      message.includes('execution reverted') ||
      message.includes('invalid opcode') ||
      message.includes('out of gas')
    ) {
      throw err;
    }

    console.warn(`[gameCaller] Gas estimation failed (transient), using floor for "${gasFloorKey}":`, message);
    return GAS_FLOOR[gasFloorKey] ?? GAS_FLOOR.default;
  }
}

function isNonceError(message: string): boolean {
  return (
    message.includes('nonce too low') ||
    message.includes('replacement transaction underpriced') ||
    message.includes('replacement fee too low') ||
    message.includes('already known')
  );
}

const MAX_NONCE_RETRIES = 2;

/**
 * Queued send: acquires a nonce from the per-wallet queue, signs, broadcasts,
 * then commits (increments) on success or resyncs on nonce failure.
 * Retries internally on nonce collisions up to MAX_NONCE_RETRIES times.
 */
async function sendRawTx(to: Address, data: Hex, gasFloorKey: keyof typeof GAS_FLOOR = 'default'): Promise<Hex> {
  const { walletClient, account } = getNextCaller();
  const nonceQueue = getNonceQueue(account.address, publicClient);

  for (let attempt = 0; attempt <= MAX_NONCE_RETRIES; attempt++) {
    const nonce = await nonceQueue.acquireNonce();

    try {
      const gas = await estimateGasWithBuffer(account, to, data, gasFloorKey);

      const request = await walletClient.prepareTransactionRequest({
        account,
        to,
        data,
        gas,
        nonce,
        chain: base,
      });

      const serialized = await walletClient.signTransaction(request);
      const hash = await publicClient.sendRawTransaction({ serializedTransaction: serialized });

      nonceQueue.commitNonce();
      return hash;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      if (isNonceError(message) && attempt < MAX_NONCE_RETRIES) {
        console.warn(`[gameCaller] Nonce error (attempt ${attempt + 1}), resyncing:`, message);
        nonceQueue.rollbackAndResync();
        continue;
      }

      nonceQueue.rollbackAndResync();
      throw err;
    }
  }

  throw new Error('[gameCaller] Exceeded max nonce retries');
}

/**
 * Fire-and-forget: sends playGameDelegated tx and returns hash immediately.
 */
export async function executeDelegatedPlay(params: {
  game: Address;
  player: Address;
  token: Address;
  amount: bigint;
  gameChoice: Hex;
  useCredits: boolean;
}) {
  const seed = buildSeed();

  const data = encodeFunctionData({
    abi: abis.router,
    functionName: 'playGameDelegated',
    args: [
      params.game,
      params.player,
      params.token,
      params.amount,
      params.gameChoice,
      seed,
      params.useCredits,
    ],
  });

  const hash = await sendRawTx(addresses.gameRouter, data, 'playGameDelegated');
  return { hash, seed };
}

/**
 * Fire-and-forget: sends settleBet tx and returns hash immediately.
 */
export async function executeSettleBet(params: { gameAddress: Address; betId: bigint }) {
  const seed = buildSeed();

  const data = encodeFunctionData({
    abi: abis.crash,
    functionName: 'settleBet',
    args: [params.betId, seed],
  });

  const hash = await sendRawTx(params.gameAddress, data, 'settleBet');
  return { hash, seed };
}
