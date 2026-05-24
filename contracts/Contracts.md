# Gambling Platform - Smart Contracts Documentation

## Overview

Plataforma de juegos on-chain deployada en **Base (chain 8453)**. Soporta 4 juegos (Crash, Flip, RPS, Wheel) con 3 modos de interacción y un sistema de créditos internos.

---

## Deployed Addresses (Base Mainnet)

| Contract     | Address                                      |
|--------------|----------------------------------------------|
| Treasury     | `0x6B622668Abfca5074ed46FaEc38133A742890CA7` |
| GameCredits  | `0x4c9ec723EC50dEEC40990a7765B1514F01754F32` |
| GameRouter   | `0xd62208C58C10C6B99c5b18cA942D81e68Df565F4` |
| CrashGame    | `0xc146A490C90934A8CcC9541c072612E7f08A0a59` |
| FlipGame     | `0xBDE14196b45A989C72D0803437677430972ED04e` |
| RPSGame      | `0xa6164D85bC0408d9df0289E475F979Aa7c8f244A` |
| WheelGame    | `0xF2A6d16Cac939a53Ce4aDa62B013a59Bb8db7184` |
| WILD Token   | `0x5d2B0fA89F75F4926Fc08cA4725b1C85118928Cb` |

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                     FRONTEND (Web)                       │
├─────────────────────────────────────────────────────────┤
│  User Wallet (MetaMask, etc.)                           │
│  ├─ approve(GameRouter, amount) + playGame (2-tx)       │
│  ├─ authorizePlays(N) para modo delegado                │
│  └─ approve(GameCredits) + purchaseCredits (credits)    │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                  GameRouter                               │
│  Entry point para todas las interacciones de juego       │
│  ├─ playGame()             → 2-tx con wallet             │
│  ├─ playGameWithCredits()  → 2-tx con créditos           │
│  └─ playGameDelegated()    → 1-tx delegado (backend)     │
│                                                          │
│  Token flow: user → GameRouter → Treasury                │
│  (GameRouter tiene approve max al Treasury por token)    │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│               Games (BaseGame)                            │
│  ├─ CrashGame   → Crash multiplier                       │
│  ├─ FlipGame    → Coin flip (x2)                         │
│  ├─ RPSGame     → Rock-Paper-Scissors (x2/draw)          │
│  └─ WheelGame   → Configurable wheel (multiple configs)  │
│                                                          │
│  explosionRate = 4% por defecto (configurable)           │
└──────────────────────┬──────────────────────────────────┘
                       │
┌──────────────────────▼──────────────────────────────────┐
│                  Treasury                                 │
│  Holds house liquidity. Games withdraw payouts from here │
└─────────────────────────────────────────────────────────┘
```

---

## 3 Modes of Play

### Mode 1: Standard (2 transactions)

**Flujo**: Usuario aprueba GameRouter → Juega → Backend resuelve

1. **Frontend**: Usuario hace `approve(GameRouter, amount)` y llama `GameRouter.playGame()`
2. **Contrato**: GameRouter pulls tokens del usuario → deposita en Treasury → crea apuesta pendiente (betId)
3. **Backend**: Llama `Game.settleBet(betId, seed)` para resolver con random
4. **Contrato**: Calcula resultado, paga al ganador desde Treasury

**Frontend calls**:
```typescript
// 1. Approve GameRouter (una sola vez o por monto exacto)
await wildToken.write.approve([gameRouterAddress, amount]);

// 2. Play
await gameRouter.write.playGame([
  gameAddress,   // e.g. CrashGame address
  gameChoice,    // encoded game params (see encoding below)
  tokenAddress,  // e.g. WILD token
  amount         // bet amount in wei
]);
```

### Mode 2: Credits (2 transactions)

**Flujo**: Usuario compra créditos → Juega con créditos → Backend resuelve

1. **Frontend**: Usuario hace `approve(GameCredits, amount)` y llama `GameCredits.purchaseCredits(token, amount)`
2. **Frontend**: Llama `GameRouter.playGameWithCredits(game, gameChoice, creditAmount)`
3. **Backend**: Llama `Game.settleBet(betId, seed)`
4. **Contrato**: Si gana, paga en WILD token directamente al jugador

**Frontend calls**:
```typescript
// Buy credits (one time)
await wildToken.write.approve([gameCreditsAddress, amount]);
await gameCredits.write.purchaseCredits([wildTokenAddress, amount]);

// Play
await gameRouter.write.playGameWithCredits([
  gameAddress,
  gameChoice,
  creditAmount  // in WILD units (18 decimals)
]);
```

### Mode 3: Delegated (1 transaction)

**Flujo**: Usuario autoriza N partidas on-chain → Backend ejecuta jugadas atómicamente

1. **Frontend**: Usuario hace `approve(GameRouter, maxUint256)` + llama `GameRouter.authorizePlays(N)`
2. **Backend**: Por cada jugada llama `GameRouter.playGameDelegated()` — descuenta 1 play del contador
3. **Contrato**: Place + settle en 1 tx. Resultado inmediato.
4. **Frontend**: Usuario puede llamar `revokePlays()` en cualquier momento para cancelar

**Frontend calls**:
```typescript
// Setup (una sola vez)
await wildToken.write.approve([gameRouterAddress, maxUint256]);
await gameRouter.write.authorizePlays([100n]); // autoriza 100 partidas

// Revocar en cualquier momento
await gameRouter.write.revokePlays();

// Consultar partidas restantes
const remaining = await gameRouter.read.authorizedPlays([playerAddress]);
```

**Backend call**:
```typescript
await gameRouter.write.playGameDelegated([
  gameAddress,    // registered game
  playerAddress,  // player
  tokenAddress,   // accepted token
  amount,         // bet amount
  gameChoice,     // encoded game params
  seed,           // random seed
  false           // useCredits
]);
```

---

## Game Choice Encoding

Cada juego tiene su propio formato de `gameChoice` (bytes). Usar las helper functions del contrato o encodear manualmente:

### CrashGame
```typescript
// multiplierChoice: 100-10000 (1x - 100x, in centesimal)
// betCount: number of rolls (1-N)
const gameChoice = encodeAbiParameters(
  [{ type: "uint256" }, { type: "uint16" }],
  [multiplierChoice, betCount]
);
```

### FlipGame
```typescript
// side: 0 = left, 1 = right
// betCount: number of flips
const gameChoice = encodeAbiParameters(
  [{ type: "uint8" }, { type: "uint16" }],
  [side, betCount]
);
```

### RPSGame
```typescript
// choice: 0 = Rock, 1 = Paper, 2 = Scissors
// betCount: number of rounds
const gameChoice = encodeAbiParameters(
  [{ type: "uint8" }, { type: "uint16" }],
  [choice, betCount]
);
```

### WheelGame
```typescript
// configId: game config ID (set by owner via addGameConfig)
// betCount: number of spins
// stopGain: profit limit to stop (0 = disabled)
// stopLoss: loss limit to stop (0 = disabled)
const gameChoice = encodeAbiParameters(
  [{ type: "uint32" }, { type: "uint16" }, { type: "uint256" }, { type: "uint256" }],
  [configId, betCount, stopGain, stopLoss]
);
```

---

## Events to Listen For

### When bet is placed (2-tx modes)
```
BetPlaced(uint256 indexed betId, address indexed player, address token, uint256 amount, uint16 betCount, bytes gameChoice)
```

### When bet is settled (all modes)
```
BetSettled(uint256 indexed betId, address indexed player, address token, uint256 totalBetAmount, uint256 payout, uint256[] outcomes)
```

### GameRouter events
```
GamePlayed(address indexed game, address indexed player, address token, uint256 amount, uint256 betId)
GamePlayedWithCredits(address indexed game, address indexed player, uint256 creditAmount, uint256 betId)
GamePlayedDelegated(address indexed game, address indexed player, address token, uint256 amount, uint256 betId, uint256 payout)
PlaysAuthorized(address indexed player, uint256 plays)
PlaysRevoked(address indexed player)
```

---

## Reading Player State

```typescript
// Get player stats
const info = await game.read.getPlayerInfo([playerAddress]);
// Returns: { totalBets, totalWins, totalInValue, totalOutValue, lastBetIds[20], lastBetIdx }

// Get last 20 bet IDs
const [ids, nextIdx] = await game.read.lastBets([playerAddress]);

// Get specific bet
const bet = await game.read.baseBets([betId]);
// Returns: { player, token, amount, betCount, placeBlockNumber, resolved, isCreditBet, payout }

// Get credit balance
const credits = await gameCredits.read.balanceOf([playerAddress]);

// Check pending bet (2-tx mode)
const pendingId = await game.read.pendingBetId([playerAddress]);
// 0 = no pending bet

// Check delegated plays remaining
const remaining = await gameRouter.read.authorizedPlays([playerAddress]);
```

---

## Frontend Integration Checklist

1. **Connect wallet** (wagmi/viem on Base chain 8453)
2. **Read balances**: WILD token balance + GameCredits balance
3. **Choose mode**: wallet (2-tx) / credits / delegated (1-tx)
4. **Encode gameChoice** for the selected game
5. **Mode 1**: `approve(GameRouter, amount)` → `playGame(...)`
6. **Mode 2**: `approve(GameCredits, amount)` → `purchaseCredits(...)` → `playGameWithCredits(...)`
7. **Mode 3**: `approve(GameRouter, maxUint256)` + `authorizePlays(N)` → backend executes
8. **Listen for events** to show results:
   - Mode 1/2: Listen `BetPlaced` → show "pending" → listen `BetSettled` → show result
   - Mode 3: Listen `GamePlayedDelegated` → result is immediate (payout in the event)
9. **Display history**: Read `lastBets()` + `baseBets(id)` for each

---

## Key Dependencies (Frontend)

```bash
npm install viem wagmi @tanstack/react-query
```

- **viem**: For ABI encoding, contract reads/writes
- **wagmi**: React hooks for wallet connection + contract interaction
- **Chain**: Base (chainId 8453)

---

## Security Notes

- `playGameDelegated` only callable by authorized `callers` (backend wallets set via `setCaller`)
- Users control delegated play exposure via `authorizePlays(N)` — backend can execute at most N plays
- Users can call `GameRouter.revokePlays()` to immediately stop all delegated play
- ERC20 approve is to `GameRouter` only — Treasury and games never receive direct approvals from users
- Credits are non-withdrawable (no rug risk on credits, winnings paid in WILD)
- Treasury is separate from game logic (funds isolated)
- Each game has configurable min/max bets per token (`setTokenConfig`)
- Explosion rate defaults to 4% (house edge mechanism, configurable per game)
