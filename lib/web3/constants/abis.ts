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
import hiLoGameJson from '@/public/ABIS/NewGames/HiLoGame.json';
import diceGameJson from '@/public/ABIS/NewGames/DiceGame.json';
import kenoGameJson from '@/public/ABIS/NewGames/KenoGame.json';
import slotGameJson from '@/public/ABIS/NewGames/SlotGame.json';
import modernSlotGameJson from '@/public/ABIS/NewGames/ModernSlotGame.json';

export const abis = {
  crash: crashGameJson.abi,
  flip: flipGameJson.abi,
  rps: rpsGameJson.abi,
  wheel: wheelGameJson.abi,
  hiLo: hiLoGameJson.abi,
  dice: diceGameJson.abi,
  keno: kenoGameJson.abi,
  slot: slotGameJson.abi,
  modernSlot: modernSlotGameJson.abi,
  router: gameRouterJson.abi,
  credits: gameCreditsJson.abi,
  referalRegistry: referalRegistryJson.abi,
  referalLogic: referalLogicV1Json.abi,
  jackpotVault: jackpotVaultJson.abi,
  wildVault: wildVaultJson.abi,
} as const;