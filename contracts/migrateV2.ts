import { network } from "hardhat";
import { parseEther } from "viem";
import fs from "fs";
import path from "path";

const { viem, networkName } = await network.create();
const client = await viem.getPublicClient();

console.log(`Starting V2 Migration on network: ${networkName}`);

// ── Read parameters ──────────────────────────────────────────────────────────

const paramsPath = path.resolve(process.cwd(), "ignition/parameters/MigrateV2.json");
const p = JSON.parse(fs.readFileSync(paramsPath, "utf8")).MigrateV2Module;

const caller: `0x${string}`        = p.caller;
const treasuryAddr: `0x${string}`  = p.treasury;
const wildcardAddr: `0x${string}`  = p.wildcard;
const crashAddr: `0x${string}`     = p.crashGame;
const flipAddr: `0x${string}`      = p.flipGame;
const rpsAddr: `0x${string}`       = p.rpsGame;
const wheelAddr: `0x${string}`     = p.wheelGame;
const oldRouterAddr: `0x${string}` = p.oldGameRouter;
const usdcAddr: `0x${string}`      = p.usdc;

const baseUSD           = p.baseUSD          ? BigInt(p.baseUSD)          : parseEther("100");
const wildPriceUSD      = p.wildPriceUSD     ? BigInt(p.wildPriceUSD)     : parseEther("0.1");
const usdcPriceUSD      = p.usdcPriceUSD     ? BigInt(p.usdcPriceUSD)     : parseEther("1");
const jackpotContrib    = p.jackpotContribBps ? BigInt(p.jackpotContribBps) : 15n;
const jackpotMaxPayout  = p.jackpotMaxPayout  ? BigInt(p.jackpotMaxPayout)  : 8000n;
const jackpotMinUSDC    = p.jackpotMinUSDC    ? BigInt(p.jackpotMinUSDC)    : 1000n * 10n ** 6n;
const jackpotMinWILD    = p.jackpotMinWILD    ? BigInt(p.jackpotMinWILD)    : parseEther("10000");

// GameCredits: how many credits per 1 USDC wei (accounts for 6 dec vs 18 dec)
// e.g. 10e12 → 1 USDC = 10 credits
const usdcCreditsRatio  = p.usdcCreditsRatio  ? BigInt(p.usdcCreditsRatio)  : 10_000_000_000_000n;

// Token configs per game (in each token's native decimals)
const usdcMinBet = p.usdcMinBet ? BigInt(p.usdcMinBet) : 1_000_000n;         // 1 USDC
const usdcMaxBet = p.usdcMaxBet ? BigInt(p.usdcMaxBet) : 100_000_000n;       // 100 USDC
const wildMinBet = p.wildMinBet ? BigInt(p.wildMinBet) : parseEther("1");     // 1 WILD
const wildMaxBet = p.wildMaxBet ? BigInt(p.wildMaxBet) : parseEther("1000");  // 1000 WILD

// ── Helper ───────────────────────────────────────────────────────────────────

const waitForTx = async (hash: `0x${string}`, label: string) => {
  console.log(`  ⏳ ${label}...`);
  const receipt = await client.waitForTransactionReceipt({ hash, confirmations: 1 });
  if (receipt.status !== "success") throw new Error(`TX failed: ${label}`);
  console.log(`  ✓ ${label}`);
};

// ── Existing contracts (no redeploy needed) ──────────────────────────────────

const treasury  = await viem.getContractAt("TreasuryTest", treasuryAddr);
const crashGame = await viem.getContractAt("CrashGame",    crashAddr);
const flipGame  = await viem.getContractAt("FlipGame",     flipAddr);
const rpsGame   = await viem.getContractAt("RPSGame",      rpsAddr);
const wheelGame = await viem.getContractAt("WheelGame",    wheelAddr);

// ── Deploy new contracts ─────────────────────────────────────────────────────

console.log("\n--- Deploying new contracts ---");

// GameCredits redeployed: new version includes setGifter + authorizedGifters
const gameCredits = await viem.deployContract("GameCredits", [wildcardAddr]);
console.log(`GameCredits:     ${gameCredits.address}`);

const gameRouter = await viem.deployContract("GameRouter", [treasuryAddr, gameCredits.address, wildcardAddr]);
console.log(`GameRouter:      ${gameRouter.address}`);

const referalRegistry = await viem.deployContract("ReferalRegistry", [gameCredits.address]);
console.log(`ReferalRegistry: ${referalRegistry.address}`);

const referalLogic = await viem.deployContract("ReferalLogicV1", [referalRegistry.address, baseUSD]);
console.log(`ReferalLogicV1:  ${referalLogic.address}`);

const jackpotVault = await viem.deployContract("JackpotVault", [treasuryAddr, jackpotContrib, jackpotMaxPayout]);
console.log(`JackpotVault:    ${jackpotVault.address}`);

const wildVault = await viem.deployContract("WildVault", [wildcardAddr]);
console.log(`WildVault:       ${wildVault.address}`);

// ── Configure ────────────────────────────────────────────────────────────────

console.log("\n--- Configuring contracts ---");

// GameCredits: add USDC as accepted token with conversion ratio + auth router/registry
await waitForTx(await gameCredits.write.setTokenRatio([usdcAddr, usdcCreditsRatio, true]), "Credits: set USDC ratio");
await waitForTx(await gameCredits.write.setSpender([gameRouter.address,      true]), "Credits: auth Router as spender");
await waitForTx(await gameCredits.write.setGifter( [referalRegistry.address, true]), "Credits: auth Registry as gifter");

// GameRouter: register games, accepted tokens, callers, integrations
await waitForTx(await gameRouter.write.setGame([crashAddr, true]), "Router: set CrashGame");
await waitForTx(await gameRouter.write.setGame([flipAddr,  true]), "Router: set FlipGame");
await waitForTx(await gameRouter.write.setGame([rpsAddr,   true]), "Router: set RPSGame");
await waitForTx(await gameRouter.write.setGame([wheelAddr, true]), "Router: set WheelGame");
await waitForTx(await gameRouter.write.setAcceptedToken([wildcardAddr, true]), "Router: accept WILD");
await waitForTx(await gameRouter.write.setAcceptedToken([usdcAddr,    true]), "Router: accept USDC");
await waitForTx(await gameRouter.write.setCaller([caller, true]),              "Router: set backend caller");
await waitForTx(await gameRouter.write.setReferalLogic([referalLogic.address]),  "Router: set ReferalLogic");
await waitForTx(await gameRouter.write.setJackpotVault([jackpotVault.address]),  "Router: set JackpotVault");

// Games: point to new GameCredits, swap to new router, set USDC + WILD token configs
const games = [
  { contract: crashGame, name: "CrashGame" },
  { contract: flipGame,  name: "FlipGame"  },
  { contract: rpsGame,   name: "RPSGame"   },
  { contract: wheelGame, name: "WheelGame" },
] as const;

for (const { contract, name } of games) {
  await waitForTx(await contract.write.setGameCredits([gameCredits.address]),        `${name}: set new GameCredits`);
  await waitForTx(await contract.write.setCaller([oldRouterAddr,      false]),        `${name}: revoke old router`);
  await waitForTx(await contract.write.setCaller([gameRouter.address, true]),         `${name}: auth new router`);
  await waitForTx(await contract.write.setTokenConfig([usdcAddr,    usdcMinBet, usdcMaxBet]), `${name}: config USDC`);
  await waitForTx(await contract.write.setTokenConfig([wildcardAddr, wildMinBet, wildMaxBet]), `${name}: config WILD`);
}

// Treasury: auth new router + jackpot vault, revoke old router
await waitForTx(await treasury.write.setAuthorizedContract([gameRouter.address,   true]),  "Treasury: auth new router");
await waitForTx(await treasury.write.setAuthorizedContract([jackpotVault.address, true]),  "Treasury: auth JackpotVault");
await waitForTx(await treasury.write.setAuthorizedContract([oldRouterAddr,        false]), "Treasury: revoke old router");

// Referral system
await waitForTx(await referalRegistry.write.setWriter([referalLogic.address, true]),  "Registry: auth logic as writer");
await waitForTx(await referalLogic.write.setTokenPrice([wildcardAddr, wildPriceUSD]), "Logic: set WILD price");
await waitForTx(await referalLogic.write.setTokenPrice([usdcAddr,     usdcPriceUSD]), "Logic: set USDC price");
await waitForTx(await referalLogic.write.setCaller([gameRouter.address, true]),        "Logic: auth router caller");

// Jackpot
await waitForTx(await jackpotVault.write.setContributor([gameRouter.address, true]),         "Jackpot: auth router contributor");
await waitForTx(await jackpotVault.write.setMinJackpotBalance([usdcAddr,    jackpotMinUSDC]), "Jackpot: set min USDC");
await waitForTx(await jackpotVault.write.setMinJackpotBalance([wildcardAddr, jackpotMinWILD]), "Jackpot: set min WILD");

console.log("\n🎉 Migration completed successfully!");
console.log("\nNew contract addresses:");
console.log(`  GameCredits:     ${gameCredits.address}`);
console.log(`  GameRouter:      ${gameRouter.address}`);
console.log(`  ReferalRegistry: ${referalRegistry.address}`);
console.log(`  ReferalLogicV1:  ${referalLogic.address}`);
console.log(`  JackpotVault:    ${jackpotVault.address}`);
console.log(`  WildVault:       ${wildVault.address}`);
