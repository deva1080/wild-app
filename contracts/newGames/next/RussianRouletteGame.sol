// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// ─────────────────────────────────────────────────────────────────────────────
//  RUSSIAN ROULETTE GAME
// ─────────────────────────────────────────────────────────────────────────────
//
//  Overview:
//    High-variance, single-outcome game. A revolver cylinder holds N chambers,
//    exactly one of which is loaded. The player "pulls the trigger" once per
//    round. Survive and win a multiplier; land on the bullet and lose the bet.
//
//  Modes (cylinder sizes):
//    - Classic  : 6 chambers  → 5/6 survival chance → ~5.8x payout
//    - Duel     : 4 chambers  → 3/4 survival chance → ~3.7x payout
//    - Hardcore : 3 chambers  → 2/3 survival chance → ~2.5x payout
//    Players select their mode before placing a bet.
//
//  Multi-pull (chain) variant:
//    Similar to Hi-Lo, the player may keep pulling after each survival.
//    Each consecutive pull uses the same cylinder (bullet position is
//    re-randomised each round, not a sequential spin) to keep VRF costs
//    predictable. The multiplier compounds with each survived pull.
//    The player may cash out after any successful pull.
//
//  Flow:
//    1. Player picks a mode and (optionally) a max number of pulls.
//    2. Player places a bet.
//    3. For each pull, a random number [0, N-1] is generated.
//       - If result == 0  → bullet chamber hit → session ends, bet is lost.
//       - Otherwise       → player survives, multiplier compounds.
//    4. After all chosen pulls or a cash-out, payout is transferred.
//
//  Key parameters:
//    - houseEdge: deducted from the fair survival multiplier.
//    - maxPulls: global cap on consecutive pulls to limit treasury exposure.
//    - maxBet per mode: scaled down for hardcore mode due to high multiplier.
// ─────────────────────────────────────────────────────────────────────────────
