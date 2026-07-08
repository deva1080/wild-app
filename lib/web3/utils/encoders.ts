import { encodeAbiParameters } from 'viem';

export function encodeCrashChoice(multiplierChoice: bigint, betCount: number): `0x${string}` {
  return encodeAbiParameters(
    [{ type: 'uint256' }, { type: 'uint16' }],
    [multiplierChoice, betCount]
  );
}

export function encodeFlipChoice(side: number, betCount: number): `0x${string}` {
  return encodeAbiParameters(
    [{ type: 'uint8' }, { type: 'uint16' }],
    [side, betCount]
  );
}

export function encodeRPSChoice(choice: number, betCount: number): `0x${string}` {
  return encodeAbiParameters(
    [{ type: 'uint8' }, { type: 'uint16' }],
    [choice, betCount]
  );
}

export function encodeSlotChoice(): `0x${string}` {
  return encodeAbiParameters(
    [{ type: 'uint16' }],
    [1]
  );
}

export function encodeKenoChoice(picks: number[], betCount: number): `0x${string}` {
  let mask = 0n;
  for (const n of picks) {
    mask |= 1n << BigInt(n - 1);
  }
  return encodeAbiParameters(
    [{ type: 'uint40' }, { type: 'uint16' }],
    [Number(mask), betCount]
  );
}

export function encodeDiceChoice(betType: number, betData: number, betCount: number): `0x${string}` {
  return encodeAbiParameters(
    [{ type: 'uint8' }, { type: 'uint8' }, { type: 'uint16' }],
    [betType, betData, betCount]
  );
}

export function encodeHiLoChoice(card: number, direction: number, betCount: number): `0x${string}` {
  return encodeAbiParameters(
    [{ type: 'uint8' }, { type: 'uint8' }, { type: 'uint16' }],
    [card, direction, betCount]
  );
}

export function encodeWheelChoice(
  configId: number,
  betCount: number,
  stopGain: bigint,
  stopLoss: bigint
): `0x${string}` {
  return encodeAbiParameters(
    [{ type: 'uint32' }, { type: 'uint16' }, { type: 'uint256' }, { type: 'uint256' }],
    [configId, betCount, stopGain, stopLoss]
  );
}