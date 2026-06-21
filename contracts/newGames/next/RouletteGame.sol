// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// ─────────────────────────────────────────────────────────────────────────────
//  ROULETTE GAME
// ─────────────────────────────────────────────────────────────────────────────
//
//  Overview:
//    European single-zero roulette (numbers 0–36).
//    Players may place one or multiple bet types in a single transaction,
//    each with its own wager amount.
//
//  Supported bet types (and their payouts):
//    - Straight  : single number              → 35x
//    - Split     : two adjacent numbers        → 17x
//    - Street    : three numbers in a row      → 11x
//    - Corner    : four numbers in a square    → 8x
//    - Line      : six numbers (two streets)   → 5x
//    - Dozen     : 1st/2nd/3rd 12             → 2x
//    - Column    : one of three columns        → 2x
//    - Red/Black : color                       → 1x
//    - Odd/Even  : parity                      → 1x
//    - Low/High  : 1–18 / 19–36               → 1x
//
//  Flow:
//    1. Player submits an array of (betType, betData, amount) tuples.
//    2. Contract records all bets and requests a random number [0–36].
//    3. On resolution, each bet is evaluated independently; all winning
//       payouts are summed and transferred to the player.
//    4. Maximum total exposure per spin is capped at a configurable
//       `maxTableExposure` to protect the treasury.
//
//  House edge:
//    Naturally embedded in the 0 pocket (American double-zero variant not
//    supported). An additional protocol fee can be applied on net winnings.
// ─────────────────────────────────────────────────────────────────────────────
