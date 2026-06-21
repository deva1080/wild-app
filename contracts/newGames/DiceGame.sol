// SPDX-License-Identifier: MIT
// @dev v0.1 beta
pragma solidity ^0.8.28;

import {BaseGame} from "../base/BaseGame.sol";

/// @title DiceGame - Two dice (d6 + d6). Bet on sum or pattern.
///
/// Bet types (uint8):
///   0 = EXACT_SUM    → betData = target sum [2-12]
///   1 = HIGH         → sum 8-12  (sum == 7 always loses)
///   2 = LOW          → sum 2-6   (sum == 7 always loses)
///   3 = EVEN         → even sum
///   4 = ODD          → odd sum
///   5 = ANY_DOUBLE   → both dice show the same face
///   6 = EXACT_DOUBLE → betData = double value [1-6]  (e.g. betData=6 → double-six)
///
/// gameChoice encoding: abi.encode(uint8 betType, uint8 betData, uint16 betCount)
///
/// Outcome encoding (outcomes[] in BetSettled):
///   each entry = die1 * 10 + die2  (e.g. 34 → die1:3 die2:4, sum 7)
///   explosion outcome = 11 (snake eyes)
///
/// House edge: ~4% embedded in the payout table (fair odds × 0.96).
///   explosionRate is set to 0 in the constructor — the edge lives entirely
///   in the payouts, avoiding the incoherent-outcome problem of scripted losses.
///
/// Payouts (x100 basis, 200 = 2x — fair × 0.96):
///   Exact sum: floor(3600 / ways-to-roll × 0.96)
///   High / Low: 230  (fair 240)
///   Even / Odd: 192  (fair 200)
///   Any Double: 576  (fair 600)
///   Exact Double: 3456 (fair 3600)

contract DiceGame is BaseGame {

    // ──────────────────── Bet type constants ────────────────────

    uint8 public constant BET_EXACT_SUM    = 0;
    uint8 public constant BET_HIGH         = 1;
    uint8 public constant BET_LOW          = 2;
    uint8 public constant BET_EVEN         = 3;
    uint8 public constant BET_ODD          = 4;
    uint8 public constant BET_ANY_DOUBLE   = 5;
    uint8 public constant BET_EXACT_DOUBLE = 6;

    // ──────────────────── Payout table ────────────────────

    // exactSumPayouts[sum] — payout in x100 basis = floor(3600 / ways × 0.96).
    // Indexes 0 and 1 are unused (sums below 2 are impossible).
    uint16[13] public exactSumPayouts = [
        0,     // 0 – unused
        0,     // 1 – unused
        3456,  // 2  → 1 way  (fair 3600 × 0.96)
        1728,  // 3  → 2 ways (fair 1800 × 0.96)
        1152,  // 4  → 3 ways (fair 1200 × 0.96)
        864,   // 5  → 4 ways (fair  900 × 0.96)
        691,   // 6  → 5 ways (fair  720 × 0.96)
        576,   // 7  → 6 ways (fair  600 × 0.96)
        691,   // 8  → 5 ways (fair  720 × 0.96)
        864,   // 9  → 4 ways (fair  900 × 0.96)
        1152,  // 10 → 3 ways (fair 1200 × 0.96)
        1728,  // 11 → 2 ways (fair 1800 × 0.96)
        3456   // 12 → 1 way  (fair 3600 × 0.96)
    ];

    uint16 public payoutHigh        = 230;   // fair 240 × 0.96
    uint16 public payoutLow         = 230;
    uint16 public payoutEven        = 192;   // fair 200 × 0.96
    uint16 public payoutOdd         = 192;
    uint16 public payoutAnyDouble   = 576;   // fair 600 × 0.96
    uint16 public payoutExactDouble = 3456;  // fair 3600 × 0.96

    // ──────────────────── Game-specific storage ────────────────────

    struct DiceBet {
        uint8 betType;
        uint8 betData; // target sum (EXACT_SUM) or double value (EXACT_DOUBLE), else 0
    }

    mapping(uint256 => DiceBet) public diceBets;

    // ──────────────────── Events ────────────────────

    /// @dev Emitted after every settlement via _afterBetSettled.
    ///      outcomes[i] = die1*10 + die2 for roll i.
    event DiceRoll(
        uint256 indexed betId,
        uint8   betType,
        uint8   betData,
        uint256[] outcomes,
        uint256 payout
    );

    // ──────────────────── Errors ────────────────────

    error InvalidBetType();
    error InvalidExactSum();    // target sum must be [2-12]
    error InvalidDoubleValue(); // double target must be [1-6]

    // ──────────────────── Constructor ────────────────────

    constructor(address _treasury) BaseGame(_treasury) {
        explosionRate = 0; // edge is in the payout table, not scripted losses
    }

    // ──────────────────── Admin ────────────────────

    /// @notice Update a single exact-sum payout.
    function setExactSumPayout(uint8 sum, uint16 payout) external onlyOwner {
        if (sum < 2 || sum > 12) revert InvalidExactSum();
        exactSumPayouts[sum] = payout;
    }

    /// @notice Update simple-bet payouts in one call.
    function setSimplePayouts(
        uint16 _high,
        uint16 _low,
        uint16 _even,
        uint16 _odd,
        uint16 _anyDouble,
        uint16 _exactDouble
    ) external onlyOwner {
        payoutHigh        = _high;
        payoutLow         = _low;
        payoutEven        = _even;
        payoutOdd         = _odd;
        payoutAnyDouble   = _anyDouble;
        payoutExactDouble = _exactDouble;
    }

    // ──────────────────── BaseGame virtuals ────────────────────

    /// @dev gameChoice = abi.encode(uint8 betType, uint8 betData, uint16 betCount)
    function _decodeBaseChoice(bytes calldata gameChoice)
        internal pure override
        returns (uint16 betCount, bytes memory specificChoice)
    {
        (uint8 betType, uint8 betData, uint16 count) = abi.decode(gameChoice, (uint8, uint8, uint16));
        betCount = count;
        specificChoice = abi.encode(betType, betData);
    }

    function _validateGameChoice(bytes memory specificChoice) internal pure override {
        (uint8 betType, uint8 betData) = abi.decode(specificChoice, (uint8, uint8));
        if (betType > BET_EXACT_DOUBLE) revert InvalidBetType();
        if (betType == BET_EXACT_SUM && (betData < 2 || betData > 12)) revert InvalidExactSum();
        if (betType == BET_EXACT_DOUBLE && (betData < 1 || betData > 6)) revert InvalidDoubleValue();
    }

    function _storeGameBet(uint256 betId, bytes memory specificChoice) internal override {
        (uint8 betType, uint8 betData) = abi.decode(specificChoice, (uint8, uint8));
        diceBets[betId] = DiceBet({betType: betType, betData: betData});
    }

    /// @dev Execute a single roll and compute payout.
    function _roll(uint256 betId, uint256 betAmount, uint256 randomWord)
        internal view override returns (uint256 payout)
    {
        DiceBet storage db = diceBets[betId];
        (uint8 die1, uint8 die2) = _rollDice(randomWord);
        uint16 mult = _getMultiplier(db.betType, db.betData, die1, die2);
        payout = betAmount * uint256(mult) / 100;
    }

    /// @dev outcome = die1 * 10 + die2  (e.g. 34 = die1:3, die2:4)
    function _getRollOutcome(uint256 /*betId*/, uint256 randomWord)
        internal pure override returns (uint256 outcome)
    {
        (uint8 die1, uint8 die2) = _rollDice(randomWord);
        outcome = uint256(die1) * 10 + uint256(die2);
    }

    /// @dev Never called — explosionRate is 0. Required stub for BaseGame.
    function _getExplosionOutcomes(uint256 betId)
        internal view override returns (uint256[] memory outcomes)
    {
        outcomes = new uint256[](baseBets[betId].betCount);
    }

    function _previewRoll(bytes memory specificChoice, uint256 betAmount, uint256 randomWord)
        internal view override returns (uint256 payout, uint256 outcome)
    {
        (uint8 betType, uint8 betData) = abi.decode(specificChoice, (uint8, uint8));
        (uint8 die1, uint8 die2) = _rollDice(randomWord);
        uint16 mult = _getMultiplier(betType, betData, die1, die2);
        payout  = betAmount * uint256(mult) / 100;
        outcome = uint256(die1) * 10 + uint256(die2);
    }

    /// @dev Never called — explosionRate is 0. Required stub for BaseGame.
    function _previewExplosionOutcomes(bytes memory /*specificChoice*/, uint16 betCount)
        internal pure override returns (uint256[] memory outcomes)
    {
        outcomes = new uint256[](betCount);
    }

    /// @dev Emits DiceRoll after every settlement (normal, atomic, and explosion).
    function _afterBetSettled(
        uint256 betId,
        uint256[] memory outcomes,
        uint256 payout
    ) internal override {
        DiceBet storage db = diceBets[betId];
        emit DiceRoll(betId, db.betType, db.betData, outcomes, payout);
    }

    // ──────────────────── Internal helpers ────────────────────

    /// @dev Derives two independent dice faces [1-6] from a single random word.
    ///      Uses different bit regions to avoid correlation.
    function _rollDice(uint256 randomWord) internal pure returns (uint8 die1, uint8 die2) {
        die1 = uint8((randomWord         % 6) + 1);
        die2 = uint8(((randomWord >> 16) % 6) + 1);
    }

    /// @dev Returns payout multiplier (x100) for the given bet and dice result.
    function _getMultiplier(
        uint8 betType,
        uint8 betData,
        uint8 die1,
        uint8 die2
    ) internal view returns (uint16) {
        uint8 sum      = die1 + die2;
        bool  isDouble = (die1 == die2);

        if (betType == BET_EXACT_SUM)    return (sum == betData)                ? exactSumPayouts[betData] : 0;
        if (betType == BET_HIGH)         return (sum >= 8)                      ? payoutHigh               : 0;
        if (betType == BET_LOW)          return (sum <= 6)                      ? payoutLow                : 0;
        if (betType == BET_EVEN)         return (sum % 2 == 0)                  ? payoutEven               : 0;
        if (betType == BET_ODD)          return (sum % 2 == 1)                  ? payoutOdd                : 0;
        if (betType == BET_ANY_DOUBLE)   return isDouble                        ? payoutAnyDouble          : 0;
        if (betType == BET_EXACT_DOUBLE) return (isDouble && die1 == betData)   ? payoutExactDouble        : 0;
        return 0;
    }

    // ──────────────────── View ────────────────────

    function getDiceBet(uint256 betId) external view returns (DiceBet memory) {
        return diceBets[betId];
    }

    /// @notice Helper to build the gameChoice bytes off-chain.
    function encodeGameChoice(uint8 betType, uint8 betData, uint16 betCount)
        external pure returns (bytes memory)
    {
        return abi.encode(betType, betData, betCount);
    }
}
