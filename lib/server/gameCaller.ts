import { randomBytes } from 'node:crypto';
import { privateKeyToAccount } from 'viem/accounts';
import { Address, Hex, createPublicClient, createWalletClient, encodeFunctionData, http, keccak256, encodePacked } from 'viem';
import { base } from 'viem/chains';
import { abis } from '@/lib/web3/constants/abis';
import { addresses } from '@/lib/web3/constants/addresses';
import { getNonceQueue } from './nonceManager';

let nextCallerIndex = 0;

const rpcUrl = process.env.BASE_RPC_URL;
const transport = http(rpcUrl && rpcUrl.length > 0 ? rpcUrl : undefined);

const publicClient = createPublicClient({ chain: base, transport });

const CALLER_ENV_KEYS = [
  'PRIVATE_WALLET_CALLER_1',
  'PRIVATE_WALLET_CALLER_2',
  'PRIVATE_WALLET_CALLER_3',
  'PRIVATE_WALLET_CALLER_4',
  'PRIVATE_WALLET_CALLER_5',
  'PRIVATE_WALLET_CALLER_6',
] as const;

function readEnvPrivateKey(keyName: (typeof CALLER_ENV_KEYS)[number]): Hex {
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
  const privateKeys = CALLER_ENV_KEYS.map(readEnvPrivateKey);

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
  playGameDelegated: 800_000n,
  settleBet: 400_000n,
  default: 800_000n,
};

// 50% overhead on top of the estimate, with a minimum floor per call type.
// If estimation fails (tx would revert) we fall back to the floor so the
// revert still lands on-chain for debugging.
const GAS_BUFFER_MULTIPLIER = 150n; // 1.50x → multiply by 150 then divide by 100

async function estimateGasWithBuffer(
  account: { address: Address },
  to: Address,
  data: Hex,
  gasFloorKey: keyof typeof GAS_FLOOR = 'default'
): Promise<bigint> {
  const floor = GAS_FLOOR[gasFloorKey] ?? GAS_FLOOR.default;
  try {
    const estimated = await publicClient.estimateGas({
      account: account.address,
      to,
      data,
    });
    const withBuffer = (estimated * GAS_BUFFER_MULTIPLIER) / 100n;
    // Always use at least the floor, in case estimation undershoots
    return withBuffer > floor ? withBuffer : floor;
  } catch {
    // Estimation failed — tx will likely revert, but we send it anyway
    // with the floor limit so the revert lands on-chain for debugging.
    return floor;
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

  // Estimate once before entering the nonce-retry loop
  const gas = await estimateGasWithBuffer(account, to, data, gasFloorKey);
  console.log(`[gameCaller] gas for ${gasFloorKey}: ${gas.toString()}`);

  for (let attempt = 0; attempt <= MAX_NONCE_RETRIES; attempt++) {
    const nonce = await nonceQueue.acquireNonce();

    try {
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

function buildPlayCode(player: Address, game: Address): Hex {
  const nonce = BigInt(`0x${randomBytes(8).toString('hex')}`);
  return keccak256(
    encodePacked(
      ['address', 'address', 'uint256', 'uint256'],
      [player, game, nonce, BigInt(Date.now())]
    )
  );
}

const ZERO_ADDRESS: Address = '0x0000000000000000000000000000000000000000';

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
  referrer?: Address;
}) {
  const seed = buildSeed();
  const playCode = buildPlayCode(params.player, params.game);

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
      playCode,
      params.referrer ?? ZERO_ADDRESS,
    ],
  });

  const hash = await sendRawTx(addresses.gameRouter, data, 'playGameDelegated');
  return { hash, seed, playCode };
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
