# Solidity — Recomendaciones de Update

> Generado: mayo 2026  
> Contexto: análisis de llamadas RPC del web-app + bugs conocidos en el flujo del Wheel.  
> Todas las adiciones son **non-breaking** salvo donde se indica explícitamente.

---

## Índice

1. [Problema crítico — Wheel eventos duales](#1-problema-crítico--wheel-eventos-duales)
2. [P1 — `GameRouter.getPlayPreflight`](#2-p1--gameroutergetplaypreflight)
3. [P2 — `BaseGame.getPlayerSnapshot`](#3-p2--basegamegetplayersnapshot)
4. [P3 — `WheelGame.getConfigBundle`](#4-p3--wheelgamegetconfigbundle)
5. [P4 — `GameRouter.getAccountState`](#5-p4--gameroutergetaccountstate)
6. [Contexto de cada cambio en el frontend](#6-contexto-de-cada-cambio-en-el-frontend)

---

## 1. Problema crítico — Wheel eventos duales

### El drama

El `WheelGame` es el único juego que emite **dos eventos por jugada** que contienen los resultados:

- `BetSettled` (heredado de `BaseGame`) — `outcomes: uint256[]`
- `Roll` (wheel-específico) — `rolled: uint8[]`, incluye `configId`

El frontend tiene lógica de reconciliación que compara ambos eventos y hace fallback al `Roll` si hay diferencias. Esta lógica existe porque **el mismatch ya ocurrió en producción** (hay un `console.warn` en `GameResultModal.tsx` línea 271 que lo prueba).

### Raíces del problema identificadas

#### 1.a — Caso explosión: solo se emite `BetSettled`, nunca `Roll`

En `_resolveWheelAtomically` (modo delegado) y en `WheelGame.settleBet` (modo 2-tx), cuando `_checkExplosion` es `true`:

```solidity
// _resolveWheelAtomically — línea 308
if (_checkExplosion(baseRandom)) {
    wheelBet.rolled = new uint8[](betCount);
    emit BetSettled(betId, ..., betAmountPerRoll * betCount, 0, new uint256[](betCount));
    return 0;
    // ❌ No se emite Roll
}
```

```solidity
// WheelGame.settleBet — línea 182
if (_checkExplosion(baseRandom)) {
    ...
    emit BetSettled(betId, ..., bet.amount * bet.betCount, 0, explosionResults);
    return;
    // ❌ No se emite Roll
}
```

Consecuencia: el frontend, cuando usa el path del receipt, no encuentra `Roll` y depende de `BetSettled.outcomes = new uint256[](betCount)` — un array de todos ceros. **Color index `0` y explosión son indistinguibles.**

#### 1.b — Tipo inconsistente entre los dos eventos

| Campo | `BetSettled` | `Roll` |
|-------|-------------|--------|
| resultados | `uint256[]` (cast de uint8) | `uint8[]` (nativo) |
| config | no incluido | `uint32 configId` |
| orden payout | antes de outcomes | después de rolled |

El frontend castea `Roll.rolled` a `bigint[]` en JS para poder comparar con `BetSettled.outcomes`. Cualquier diferencia en cómo viem decodifica `uint8[]` vs `uint256[]` puede causar comparaciones falsamente negativas.

#### 1.c — Fuente de verdad ambigua

El frontend necesita saber cuál evento priorizar. Actualmente usa `Roll` cuando hay discrepancia, lo cual asume que `Roll` siempre es más confiable. Pero `Roll` no existe en la explosión. La lógica de fallback crea un caso esquina no testeado.

### Solución propuesta — Opción A (recomendada, non-breaking)

**Siempre emitir `Roll` en el Wheel, incluso en explosión, con un flag `isExplosion`.**

```solidity
event Roll(
    uint256 indexed id,
    address indexed receiver,
    address indexed token,
    uint256 totalBetAmount,
    uint32 configId,
    uint8[] rolled,
    uint256 payout,
    bool isExplosion   // ← NUEVO campo
);
```

Cambiar todas las emisiones de `Roll` para incluir el flag:

```solidity
// Explosion case — ahora emite Roll también
if (_checkExplosion(baseRandom)) {
    uint8[] memory emptyRolled = new uint8[](betCount);
    wheelBet.rolled = emptyRolled;
    emit BetSettled(..., 0, new uint256[](betCount));
    emit Roll(betId, player, token, totalBet, wheelBet.configId, emptyRolled, 0, true);
    //                                                                            ^^^^
    return 0;
}

// Normal case
emit Roll(betId, ..., rolledColors, totalPayout, false);
//                                               ^^^^^
```

> ⚠️ **Esto modifica la firma del evento `Roll`** — cambia el topic0 (`keccak256` del evento cambia). El frontend necesita actualizar el ABI del wheel. Los indexers externos que escuchan el `Roll` viejo dejarán de matchear.  
> `BetSettled` no se toca — sigue siendo el evento canónico compartido.

### Solución propuesta — Opción B (más simple, también non-breaking en `BetSettled`)

**Usar un valor sentinel para explosión en `outcomes`** en lugar de todos ceros.

Definir una constante:

```solidity
uint256 internal constant EXPLOSION_OUTCOME = type(uint8).max; // 255
```

Cambiar `_getExplosionOutcomes` en WheelGame:

```solidity
function _getExplosionOutcomes(uint256 betId)
    internal view override returns (uint256[] memory outcomes)
{
    uint16 count = baseBets[betId].betCount;
    outcomes = new uint256[](count);
    for (uint16 i; i < count;) {
        outcomes[i] = EXPLOSION_OUTCOME; // 255 en vez de 0
        unchecked { ++i; }
    }
}
```

Y en `_resolveWheelAtomically`:

```solidity
if (_checkExplosion(baseRandom)) {
    uint8[] memory explosionRolled = new uint8[](betCount);
    for (uint16 i; i < betCount;) {
        explosionRolled[i] = type(uint8).max;
        unchecked { ++i; }
    }
    wheelBet.rolled = explosionRolled;
    uint256[] memory explosionOutcomes = new uint256[](betCount);
    for (uint16 i; i < betCount;) {
        explosionOutcomes[i] = type(uint8).max;
        unchecked { ++i; }
    }
    emit BetSettled(betId, ..., 0, explosionOutcomes);
    emit Roll(betId, ..., explosionRolled, 0);
    return 0;
}
```

> ✅ Non-breaking en `BetSettled`.  
> ✅ `Roll` sigue teniendo la misma firma.  
> ✅ El frontend puede distinguir explosión con `outcomes[0] === 255n`.  
> ⚠️ Requiere que `_maxColors` nunca llegue a 256 (actualmente es `uint8`, máximo 255 — ya es una limitación del diseño).

### Recomendación final sobre el Wheel

La **Opción A** es más explícita y robusta. La **Opción B** es más barata de implementar y no requiere migración de indexers.

**En cualquier caso**, independientemente de qué opción se elija, hay que **siempre emitir `Roll` en el path de explosión**. El frontend actualmente maneja el caso `wheelRollResult === null` pero resulta en un resultado ambiguo para el usuario.

---

## 2. P1 — `GameRouter.getPlayPreflight`

### Problema

Cada click en "Play" (modo standard/credits) dispara **10 RPCs en paralelo** desde `usePreflightCheck.check()`. 8 de esos son llamadas a view functions de contratos que el propio `GameRouter` podría resolver internamente.

### Llamadas actuales

| # | Llamada | Contrato |
|---|---------|----------|
| 1 | `getBalance(player)` | nativo — el frontend lo hace igual |
| 2 | `WILD.balanceOf(player)` | ERC20 — el frontend lo hace igual |
| 3 | `GameRouter.registeredGames(game)` | GameRouter |
| 4 | `Treasury.authorizedContracts(router)` | Treasury |
| 5 | `Treasury.acceptedTokens(WILD)` | Treasury |
| 6 | `WILD.balanceOf(treasury)` | ERC20 |
| 7 | `game.gameIsLive()` | BaseGame |
| 8 | `game.callers(router)` | BaseGame |
| 9 | `game.supportedTokenInfo(WILD)` | BaseGame |
| 10 | `game.pendingBetId(player)` | BaseGame |

Las llamadas 3–10 pueden resolverse en una sola `eth_call`.

### Cambio propuesto

Agregar en `GameRouter.sol`:

```solidity
struct PlayPreflight {
    bool gameRegistered;          // registeredGames[game]
    bool routerAuthorizedOnTreasury; // treasury.authorizedContracts(router)
    bool tokenAccepted;           // acceptedTokens[token]
    bool tokenAcceptedOnTreasury; // treasury.acceptedTokens(token)
    bool gameLive;                // game.gameIsLive()
    bool routerIsCaller;          // game.callers(router)
    uint128 minBet;               // game.supportedTokenInfo(token).minBetAmount
    uint128 maxBet;               // game.supportedTokenInfo(token).maxBetAmount
    uint256 treasuryTokenBalance; // IERC20(token).balanceOf(treasury)
    uint256 pendingBetId;         // game.pendingBetId(player)
}

function getPlayPreflight(
    address player,
    address game,
    address token
) external view returns (PlayPreflight memory result) {
    result.gameRegistered          = registeredGames[game];
    result.routerAuthorizedOnTreasury = treasury.authorizedContracts(address(this));
    result.tokenAccepted           = acceptedTokens[token];
    result.tokenAcceptedOnTreasury = treasury.acceptedTokens(token);
    result.gameLive                = IBaseGame(game).gameIsLive();
    result.routerIsCaller          = IBaseGame(game).callers(address(this));
    IBaseGame.TokenConfig memory tc = IBaseGame(game).supportedTokenInfo(token);
    result.minBet                  = tc.minBetAmount;
    result.maxBet                  = tc.maxBetAmount;
    result.treasuryTokenBalance    = IERC20(token).balanceOf(address(treasury));
    result.pendingBetId            = IBaseGame(game).pendingBetId(player);
}
```

> El frontend sigue haciendo `getBalance(player)` y `WILD.balanceOf(player)` (no reducibles a contrato sin pasar los addresses), pero el resto queda en **1 sola `eth_call`**.

**Impacto:** de 10 a ~3 RPCs por jugada.

### Notas de implementación

- `IBaseGame` necesita exponer `gameIsLive()`, `callers(address)`, `supportedTokenInfo(address)` y `pendingBetId(address)` como `external view`. Revisar si ya están en `IBaseGame.sol` o solo en `BaseGame`.
- `ITreasury` necesita exponer `authorizedContracts(address)` y `acceptedTokens(address)` como `external view`.
- La función es `view` pura — no hay escritura de estado ni riesgo de reentrancy.

---

## 3. P2 — `BaseGame.getPlayerSnapshot`

### Problema

`usePlayerState` hace 3 llamadas separadas en cada game page para obtener datos del jugador que en la UI actual **no se renderizan** (solo `pendingBetId` se usa activamente). Pero cuando se agregue un historial o dashboard, se necesitarán los 3 en paralelo.

### Cambio propuesto

Agregar en `BaseGame.sol`:

```solidity
struct PlayerSnapshot {
    uint256 pendingBetId;
    uint32 totalBets;
    uint32 totalWins;
    uint256 totalInValue;
    uint256 totalOutValue;
}

function getPlayerSnapshot(address player) external view returns (PlayerSnapshot memory) {
    PlayerInfo storage pi = playerInfo[player];
    return PlayerSnapshot({
        pendingBetId: pendingBetId[player],
        totalBets:    pi.totalBets,
        totalWins:    pi.totalWins,
        totalInValue: pi.totalInValue,
        totalOutValue: pi.totalOutValue
    });
}
```

> Intencional: no incluye `lastBetIds` / `lastBetIdx` en el snapshot base. Si se necesita el historial completo, la función `lastBets(player)` ya existe.

**Impacto:** reemplaza `getPlayerInfo` + `pendingBetId` + (opcionalmente) `lastBets` — de 3 reads a 1.

---

## 4. P3 — `WheelGame.getConfigBundle`

### Problema

`useWheelConfig` hace 3 llamadas separadas para renderizar la config del wheel:

1. `configsCount()` — cantidad total de configs (se hace una sola vez al mount)
2. `gameConfigs(configId)` — multipliers, weights, gameId
3. `supportedTokenInfo(token)` — minBet, maxBet

Las llamadas 2 y 3 se pueden combinar.

### Cambio propuesto

Agregar en `WheelGame.sol`:

```solidity
struct ConfigBundle {
    GameConfig config;        // weightRanges, multipliers, maxMultiplier, gameId
    TokenConfig tokenInfo;    // minBetAmount, maxBetAmount
}

function getConfigBundle(
    uint32 configId,
    address token
) external view returns (ConfigBundle memory) {
    return ConfigBundle({
        config:    _gameConfigs[configId],
        tokenInfo: supportedTokenInfo[token]
    });
}
```

**Impacto:** de 3 a 2 reads por mount del Wheel (el `configsCount` sigue separado porque se necesita saber cuántas configs hay antes de pedir la específica).

---

## 5. P4 — `GameRouter.getAccountState`

### Problema

`TxModeProvider` hace dos reads al mount para determinar el modo de play del usuario:

1. `GameRouter.authorizedPlays(player)` — cuántas jugadas delegadas tiene autorizadas
2. `GameCredits.balanceOf(player)` — balance de credits

### Cambio propuesto

Agregar en `GameRouter.sol`:

```solidity
struct AccountState {
    uint256 authorizedPlays;
    uint256 creditsBalance;
}

function getAccountState(address player) external view returns (AccountState memory) {
    return AccountState({
        authorizedPlays: authorizedPlays[player],
        creditsBalance:  gameCredits.balanceOf(player)
    });
}
```

**Impacto:** de 2 a 1 read por mount del context provider (afecta a todas las páginas).

---

## 6. Contexto de cada cambio en el frontend

Esta sección explica por qué cada view function es necesaria, para que el dev Solidity entienda el caso de uso completo.

### Por qué `getPlayPreflight` es P1

`usePreflightCheck.check()` se llama **cada vez que el usuario hace click en "Play"** en modo standard o credits. El tiempo que tarda en resolver los 10 eth_calls bloquea el flujo antes de mostrar el modal de confirmación. En modo delegado, este preflight se omite completamente — lo que demuestra que puede simplificarse sin romper seguridad.

### Por qué el Wheel es el juego más problemático

El Wheel es el único juego con:
- Stop-gain / stop-loss (genera multi-rolls con early exit)
- Evento `Roll` adicional al `BetSettled` base
- `betCount > 1` por default
- Assembly para truncar el array de results

Cada una de estas features por separado es razonable. Juntas crean el caso esquina donde los dos eventos pueden divergir o el frontend no puede distinguir el resultado correctamente.

### Estado actual del frontend respecto a los eventos del Wheel

El archivo `components/GameResultModal.tsx` tiene dos paths de resolución que **corren en paralelo y compiten**:

1. **Path WSS** (`useBetSettledListener`): escucha `BetSettled` via WebSocket. Solo procesa `BetSettled`, no `Roll`. Filtra por `betId` exacto.
2. **Path receipt** (`waitForSettleTx` / `waitForDelegatedTx`): espera 2 confirmaciones + 1.5s de delay + re-fetch del receipt. Luego llama a `decodeBetSettledFromLogs` que busca ambos eventos y compara.

El path WSS gana si llega primero y el betId coincide. El path receipt sirve de fallback.

El problema es que si el path WSS gana con datos del `BetSettled` y hay discrepancia con el `Roll`, el usuario ya vio el resultado "incorrecto" antes de que el path receipt pudiera corregirlo.

### Sobre `getPlayerSnapshot` — datos no renderizados actualmente

`getPlayerInfo` y `lastBets` se fetchan en `usePlayerState` pero los datos no se usan en ningún componente actual. Están "reservados" para un futuro historial de jugadas. Por ahora son reads desperdiciadas. Con `getPlayerSnapshot`, el frontend puede obtener solo `pendingBetId` (crítico) y el resumen estadístico básico en una sola llamada.

---

## Resumen de impacto

| Prioridad | Cambio | RPCs eliminados | Afecta |
|-----------|--------|-----------------|--------|
| Crítico | Fix Wheel explosion + siempre emitir `Roll` | 0 RPCs, soluciona bug | WheelGame |
| P1 | `GameRouter.getPlayPreflight` | 7–8 RPCs por jugada | GameRouter, IBaseGame, ITreasury |
| P2 | `BaseGame.getPlayerSnapshot` | 2 RPCs por mount | BaseGame |
| P3 | `WheelGame.getConfigBundle` | 1 RPC por mount | WheelGame |
| P4 | `GameRouter.getAccountState` | 1 RPC por mount | GameRouter |
