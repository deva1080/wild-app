// SPDX-License-Identifier: MIT
// @dev v0.1 beta
pragma solidity ^0.8.28;

import {BaseGame} from "../base/BaseGame.sol";

/// @title SlotGame — Classic 3×3 slot machine, 5 fixed paylines.
///
/// Grid layout (flat, row-major):
///   [0] [1] [2]   row 0
///   [3] [4] [5]   row 1
///   [6] [7] [8]   row 2
///   cell(row, col) = grid[row * 3 + col]
///
/// Integration notes:
///   - Inherits BaseGame / GameRouter / Treasury flow exactly like FlipGame.
///   - betCount is always 1 (one spin per bet). The router encodes uint16(1).
///   - Randomness: backend seed + blockhash + prevrandao (no external oracle).
///   - explosionRate = 0: losses are handled by the pay table RTP, not forced explosions.
///   - _getRollOutcome packs the 9 symbols (3 bits each) into a single uint256.
///     The generic BetSettled event carries outcomes[0] = packed grid.
///   - SlotSpun emits the decoded grid + win for UI rendering.
contract SlotGame is BaseGame {

    // ─── Symbols ────────────────────────────────────────────────────────────
    // 0=Cherry  1=Lemon  2=Orange  3=Grape  4=Bell  5=Diamond

    uint8  public constant NUM_SYMBOLS   = 6;
    uint32 public constant TOTAL_WEIGHT  = 99999;

    // Cumulative weight thresholds (Cherry..Diamond).
    // Cherry: 0..34999 | Lemon: 35000..61999 | Orange: 62000..81999
    // Grape:  82000..92999 | Bell: 93000..97999 | Diamond: 98000..99998
    uint32[6] private _cumW = [
        uint32(35000), // Cherry
        62000,         // + Lemon
        82000,         // + Orange
        93000,         // + Grape
        98000,         // + Bell
        99999          // + Diamond
    ];

    // 3-of-a-kind payout multipliers: win = bet * _payTable[symbol]
    uint16[6] private _payTable = [
        uint16(1),   // Cherry   x1
        2,           // Lemon    x2
        5,           // Orange   x5
        20,          // Grape    x20
        200,         // Bell     x200
        2525         // Diamond  x2525
    ];

    // 5 fixed paylines: each entry is [rowOfCol0, rowOfCol1, rowOfCol2]
    uint8[3][5] private _paylines = [
        [0, 0, 0], // top horizontal
        [1, 1, 1], // middle horizontal
        [2, 2, 2], // bottom horizontal
        [0, 1, 2], // diagonal descending ↘
        [2, 1, 0]  // diagonal ascending  ↗
    ];

    // ─── Events ─────────────────────────────────────────────────────────────

    /// @notice Emitted after every spin settlement (classic 2-tx, atomic 1-tx, and explosion).
    /// The generic BetSettled event is also emitted by BaseGame with outcomes[0] = packed grid.
    event SlotSpun(
        uint256 indexed betId,
        address indexed player,
        uint8[9] grid,   // row-major: cell(row,col) = grid[row*3+col]
        uint256 bet,     // amount per spin
        uint256 win      // total payout (0 on loss)
    );

    // ─── Errors ─────────────────────────────────────────────────────────────

    error BetCountMustBeOne();

    // ─── Constructor ────────────────────────────────────────────────────────

    constructor(address _treasury) BaseGame(_treasury) {
        // Slots do not use the forced-loss explosion mechanic.
        // RTP is fully controlled by the pay table weights.
        explosionRate = 0;
    }

    // ─── BaseGame virtual overrides ─────────────────────────────────────────

    /// @dev gameChoice = abi.encode(uint16 betCount), always 1 for slots.
    function _decodeBaseChoice(bytes calldata gameChoice)
        internal pure override
        returns (uint16 betCount, bytes memory specificChoice)
    {
        betCount = abi.decode(gameChoice, (uint16));
        if (betCount != 1) revert BetCountMustBeOne();
        specificChoice = "";
    }

    /// @dev No player choice in slots — validation is a no-op.
    function _validateGameChoice(bytes memory) internal pure override {}

    /// @dev No game-specific per-bet state to store.
    function _storeGameBet(uint256, bytes memory) internal override {}

    /// @dev Generate the 3×3 grid from randomWord and evaluate all 5 paylines.
    function _roll(uint256, uint256 betAmount, uint256 randomWord)
        internal view override
        returns (uint256 payout)
    {
        uint8[9] memory grid = _generateGrid(randomWord);
        payout = _evaluatePaylines(grid, betAmount);
    }

    /// @dev Pack the 9 grid symbols (3 bits each) into a uint256.
    ///      Encoding: bits[(i*3)..(i*3+2)] = symbol of cell i.
    function _getRollOutcome(uint256, uint256 randomWord)
        internal view override
        returns (uint256 outcome)
    {
        uint8[9] memory grid = _generateGrid(randomWord);
        outcome = _packGrid(grid);
    }

    /// @dev Explosion outcome: single-element array with packed all-zero grid (no payline hit).
    function _getExplosionOutcomes(uint256)
        internal pure override
        returns (uint256[] memory outcomes)
    {
        outcomes = new uint256[](1);
        outcomes[0] = _explosionPackedGrid();
    }

    /// @dev Stateless preview of a single spin.
    function _previewRoll(bytes memory, uint256 betAmount, uint256 randomWord)
        internal view override
        returns (uint256 payout, uint256 outcome)
    {
        uint8[9] memory grid = _generateGrid(randomWord);
        payout   = _evaluatePaylines(grid, betAmount);
        outcome  = _packGrid(grid);
    }

    /// @dev Stateless explosion preview.
    function _previewExplosionOutcomes(bytes memory, uint16)
        internal pure override
        returns (uint256[] memory outcomes)
    {
        outcomes = new uint256[](1);
        outcomes[0] = _explosionPackedGrid();
    }

    function _getRefundAmount(uint256 betId) internal view override returns (uint256) {
        BaseBet storage bet = baseBets[betId];
        return bet.amount * bet.betCount;
    }

    /// @dev Emits SlotSpun after every settlement. outcomes[0] is the packed grid.
    function _afterBetSettled(
        uint256 betId,
        uint256[] memory outcomes,
        uint256 payout
    ) internal override {
        BaseBet storage bet = baseBets[betId];
        uint8[9] memory grid = _unpackGrid(outcomes[0]);
        emit SlotSpun(betId, bet.player, grid, bet.amount, payout);
    }

    // ─── Grid generation ────────────────────────────────────────────────────

    function _generateGrid(uint256 seed)
        internal view
        returns (uint8[9] memory grid)
    {
        uint32[6] memory cw = _cumW;
        for (uint256 i = 0; i < 9; ) {
            uint32 rand = uint32(
                uint256(keccak256(abi.encode(seed, i))) % TOTAL_WEIGHT
            );
            grid[i] = _symbolFromRandom(cw, rand);
            unchecked { ++i; }
        }
    }

    function _symbolFromRandom(uint32[6] memory cw, uint32 rand)
        internal pure
        returns (uint8)
    {
        for (uint8 s = 0; s < NUM_SYMBOLS; ) {
            if (rand < cw[s]) return s;
            unchecked { ++s; }
        }
        return NUM_SYMBOLS - 1;
    }

    // ─── Payline evaluation ─────────────────────────────────────────────────

    /// @dev For each payline, check if the 3 symbols match; accumulate win.
    function _evaluatePaylines(uint8[9] memory grid, uint256 bet)
        internal view
        returns (uint256 totalWin)
    {
        uint8[3][5] memory pl = _paylines;
        uint16[6]   memory pt = _payTable;
        for (uint256 i = 0; i < 5; ) {
            uint8 s0 = grid[uint256(pl[i][0]) * 3];
            uint8 s1 = grid[uint256(pl[i][1]) * 3 + 1];
            uint8 s2 = grid[uint256(pl[i][2]) * 3 + 2];
            if (s0 == s1 && s1 == s2) {
                totalWin += bet * uint256(pt[s0]);
            }
            unchecked { ++i; }
        }
    }

    // ─── Packing ────────────────────────────────────────────────────────────

    /// @dev Pack 9 symbols (values 0-5, 3 bits each) into a uint256.
    ///      Total: 9 × 3 = 27 bits used.
    function _packGrid(uint8[9] memory grid)
        internal pure
        returns (uint256 packed)
    {
        for (uint256 i = 0; i < 9; ) {
            packed |= uint256(grid[i]) << (i * 3);
            unchecked { ++i; }
        }
    }

    function _unpackGrid(uint256 packed)
        internal pure
        returns (uint8[9] memory grid)
    {
        for (uint256 i = 0; i < 9; ) {
            grid[i] = uint8((packed >> (i * 3)) & 0x7);
            unchecked { ++i; }
        }
    }

    /// @dev Returns a packed grid guaranteed to hit no payline.
    ///      [Cherry, Lemon, Orange, Grape, Bell, Diamond, Cherry, Lemon, Orange]
    ///      No three consecutive symbols match across any payline.
    function _explosionPackedGrid() internal pure returns (uint256) {
        // [0,1,2, 3,4,5, 0,1,2]
        return 0
            | (uint256(0) << 0)  | (uint256(1) << 3)  | (uint256(2) << 6)
            | (uint256(3) << 9)  | (uint256(4) << 12) | (uint256(5) << 15)
            | (uint256(0) << 18) | (uint256(1) << 21) | (uint256(2) << 24);
    }

    // ─── View helpers ────────────────────────────────────────────────────────

    /// @notice Encode a slot game choice. Always betCount = 1.
    function encodeGameChoice() external pure returns (bytes memory) {
        return abi.encode(uint16(1));
    }

    /// @notice Decode a packed grid outcome for off-chain inspection.
    function decodeGrid(uint256 packed) external pure returns (uint8[9] memory) {
        return _unpackGrid(packed);
    }
}
