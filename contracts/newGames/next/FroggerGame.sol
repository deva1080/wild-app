// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// ─────────────────────────────────────────────────────────────────────────────
//  FROGGER GAME  (step-based crash)
// ─────────────────────────────────────────────────────────────────────────────
//
//  Overview:
//    A step-by-step crash variant inspired by the classic Frogger arcade game.
//    Instead of a continuous multiplier that can bust at any moment, the risk
//    is broken into discrete "lanes" (rows the frog must cross). Each lane has
//    an independent probability of containing a hazard. The player decides
//    upfront how many lanes to attempt, or may hop lane-by-lane and cash out
//    after each successful crossing.
//
//  Lanes & multipliers (example with 8 lanes):
//    Lane 1  : 75 % safe → ~1.3x
//    Lane 2  : 70 % safe → ~1.7x
//    Lane 3  : 65 % safe → ~2.3x
//    Lane 4  : 60 % safe → ~3.4x
//    Lane 5  : 55 % safe → ~5.5x
//    Lane 6  : 50 % safe → ~9.5x
//    Lane 7  : 45 % safe → ~17x
//    Lane 8  : 40 % safe → ~35x
//    Multipliers are cumulative products of per-lane fair odds minus house edge.
//
//  Flow (manual mode — lane by lane):
//    1. Player opens a session with an initial bet.
//    2. Player sends a "hop" transaction for the next lane.
//    3. A random number is drawn; if it falls in the hazard range the frog
//       dies — session ends, bet is lost.
//    4. If safe, the current multiplier is updated and stored.
//    5. Player may call cashOut() at any time after a successful hop to
//       receive initialBet * currentMultiplier.
//
//  Flow (auto mode — pre-committed lanes):
//    1. Player commits to a target lane count N upfront.
//    2. A single VRF request generates N random values, one per lane.
//    3. All lanes are evaluated in sequence; the frog stops at the first
//       hazard hit or completes all N lanes.
//    4. Payout is determined by the last safely crossed lane.
//
//  Key parameters:
//    - laneCount: total available lanes (configurable, e.g. 8–12).
//    - laneHazardBps[i]: hazard probability for each lane in basis points.
//    - sessionTimeout: blocks before an idle manual session is force-closed.
//    - houseEdge: applied globally when computing per-lane multipliers.
//
//  Relationship to CrashGame:
//    Unlike CrashGame (which uses a continuous exponential curve), Frogger's
//    risk is discrete and visible upfront. Players can see exactly what
//    probability they face at each lane before deciding to hop.
// ─────────────────────────────────────────────────────────────────────────────
