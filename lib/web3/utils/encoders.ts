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