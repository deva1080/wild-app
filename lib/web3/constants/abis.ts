import crashGameJson from '@/public/ABIS/CrashGame.json';
import flipGameJson from '@/public/ABIS/FlipGame.json';
import rpsGameJson from '@/public/ABIS/RPSGame.json';
import wheelGameJson from '@/public/ABIS/WheelGame.json';
import gameRouterJson from '@/public/ABIS/GameRouter.json';
import gameCreditsJson from '@/public/ABIS/GameCredits.json';
import referalRegistryJson from '@/public/ABIS/ReferalRegistry.json';
import referalLogicV1Json from '@/public/ABIS/ReferalLogicV1.json';
import jackpotVaultJson from '@/public/ABIS/JackpotVault.json';
import wildVaultJson from '@/public/ABIS/WildVault.json';

export const abis = {
  crash: crashGameJson.abi,
  flip: flipGameJson.abi,
  rps: rpsGameJson.abi,
  wheel: wheelGameJson.abi,
  router: gameRouterJson.abi,
  credits: gameCreditsJson.abi,
  referalRegistry: referalRegistryJson.abi,
  referalLogic: referalLogicV1Json.abi,
  jackpotVault: jackpotVaultJson.abi,
  wildVault: wildVaultJson.abi,
} as const;