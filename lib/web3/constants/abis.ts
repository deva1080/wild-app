import crashGameJson from '@/public/ABIS/CrashGame.json';
import flipGameJson from '@/public/ABIS/FlipGame.json';
import rpsGameJson from '@/public/ABIS/RPSGame.json';
import wheelGameJson from '@/public/ABIS/WheelGame.json';
import gameRouterJson from '@/public/ABIS/GameRouter.json';
import gameCreditsJson from '@/public/ABIS/GameCredits.json';

export const abis = {
  crash: crashGameJson.abi,
  flip: flipGameJson.abi,
  rps: rpsGameJson.abi,
  wheel: wheelGameJson.abi,
  router: gameRouterJson.abi,
  credits: gameCreditsJson.abi,
} as const;