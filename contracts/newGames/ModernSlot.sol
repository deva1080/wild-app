// SPDX-License-Identifier: MIT
// @dev v0.1 beta
pragma solidity ^0.8.28;

import {BaseGame} from "../base/BaseGame.sol";

/// @title ModernSlotGame — N×M configurable slot with WILD multipliers and ways-to-win engine.
///
/// Grid layout (reel-major):
///   cell(reel, row) = grid[reel * ROWS + row]
///
/// Ways-to-win engine (left-aligned):
///   For each payable symbol, count how many cells per reel contain that symbol or WILD,
///   starting from reel 0. Stop at the first reel with zero matches.
///   ways = product of counts across qualifying reels.
///   win  = (bet × payout(symbol, length) × ways) / payDenom
///
/// WILD mechanics:
///   - Symbol 6 (WILD) substitutes any payable symbol in the ways count.
///   - Each WILD cell carries an individual multiplier (x2 / x3 / x5, 70/25/5 %).
///   - globalMultiplier = product of all WILD multipliers in the grid (capped at MAX_GLOBAL_MULT).
///   - totalWin = baseWin × globalMultiplier.
///
/// Integration notes:
///   - Inherits BaseGame / GameRouter / Treasury flow exactly like FlipGame.
///   - betCount is always 1. Encode with encodeGameChoice().
///   - Randomness: backend seed + blockhash + prevrandao.
///   - explosionRate = 0: losses handled by the pay table RTP.
///   - _getRollOutcome packs (symbol:3bits, encodedWildMult:2bits) per cell → uint256.
///     Max grid: 7×7 = 49 cells × 5 bits = 245 bits < 256. ✓
///   - ModernSlotSpun emits the full decoded grid + wild data for UI rendering.
contract ModernSlotGame is BaseGame {

    // ─── Symbols ────────────────────────────────────────────────────────────
    // 0=Cherry  1=Lemon  2=Orange  3=Grape  4=Bell  5=Diamond  (payable)
    // 6=WILD: substitutes any payable; carries a per-cell multiplier.

    uint8  public constant WILD           = 6;
    uint8  public constant NUM_PAYABLE    = 6;
    uint8  public constant NUM_SYMBOLS    = 7;
    uint8  public constant MIN_MATCH      = 3;
    uint32 public constant TOTAL_WEIGHT   = 100000;
    uint256 public constant MAX_GLOBAL_MULT = 1000;

    // Cumulative weights (Cherry..Diamond..WILD).
    // Approx probabilities: Cherry 34% | Lemon 26% | Orange 19% | Grape 10.5%
    //                       Bell 4.8% | Diamond 1.9% | WILD 3.8%
    uint32[7] private _cumW = [
        uint32(34000), // Cherry
        60000,         // + Lemon
        79000,         // + Orange
        89500,         // + Grape
        94300,         // + Bell
        96200,         // + Diamond
        100000         // + WILD
    ];

    // ─── Grid dimensions (immutable) ────────────────────────────────────────

    uint8 public immutable REELS; // columns
    uint8 public immutable ROWS;  // rows per reel

    // ─── RTP calibration ────────────────────────────────────────────────────

    /// @notice Denominator for the ways-to-win payout formula.
    ///         win = bet × payout(sym, length) × ways / payDenom.
    ///         Adjust to tune RTP without redeploying. Default: 1000 → ~97 % on 5×3.
    uint256 public payDenom;

    // ─── Events ─────────────────────────────────────────────────────────────

    /// @notice Emitted after every spin settlement.
    /// The generic BetSettled event is also emitted by BaseGame with outcomes[0] = packed data.
    event ModernSlotSpun(
        uint256 indexed betId,
        address indexed player,
        uint8[]  grid,             // reel-major: cell(reel,row) = grid[reel*ROWS + row]
        uint8[]  wildMultipliers,  // per-cell multiplier: 0 = not WILD, 2/3/5 = WILD mult
        uint256  globalMultiplier,
        uint256  bet,              // amount per spin
        uint256  win               // total payout (0 on loss)
    );

    event PayDenomUpdated(uint256 oldValue, uint256 newValue);

    // ─── Errors ─────────────────────────────────────────────────────────────

    error BetCountMustBeOne();
    error InvalidPayDenom();

    // ─── Constructor ────────────────────────────────────────────────────────

    constructor(
        address _treasury,
        uint8   reels,
        uint8   rows,
        uint256 _payDenom
    ) BaseGame(_treasury) {
        require(reels >= 1 && reels <= 7, "reels 1..7");
        require(rows  >= 1 && rows  <= 7, "rows 1..7");
        require(_payDenom >= 1, "payDenom >= 1");
        REELS    = reels;
        ROWS     = rows;
        payDenom = _payDenom;
        // Losses are handled by the pay table RTP; forced explosions are disabled.
        explosionRate = 0;
    }

    // ─── Admin ──────────────────────────────────────────────────────────────

    /// @notice Adjust the RTP denominator without redeploying. Validate against
    ///         your off-chain RTP simulator before applying to production.
    function setPayDenom(uint256 _payDenom) external onlyOwner {
        if (_payDenom == 0) revert InvalidPayDenom();
        emit PayDenomUpdated(payDenom, _payDenom);
        payDenom = _payDenom;
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

    /// @dev Generate grid, evaluate ways-to-win with WILD multipliers, return payout.
    function _roll(uint256, uint256 betAmount, uint256 randomWord)
        internal view override
        returns (uint256 payout)
    {
        uint256 cells = uint256(REELS) * ROWS;
        uint8[] memory grid     = new uint8[](cells);
        uint8[] memory wildMult = new uint8[](cells);
        _buildGrid(randomWord, cells, grid, wildMult);
        (uint256 baseWin, uint256 globalMult) = _evaluate(grid, wildMult, betAmount);
        payout = baseWin * globalMult;
    }

    /// @dev Pack (symbol:3bits, encodedWildMult:2bits) per cell into a uint256.
    ///      5 bits per cell × max 49 cells = 245 bits < 256. ✓
    function _getRollOutcome(uint256, uint256 randomWord)
        internal view override
        returns (uint256 outcome)
    {
        uint256 cells = uint256(REELS) * ROWS;
        uint8[] memory grid     = new uint8[](cells);
        uint8[] memory wildMult = new uint8[](cells);
        _buildGrid(randomWord, cells, grid, wildMult);
        outcome = _packOutcome(grid, wildMult, cells);
    }

    function _getExplosionOutcomes(uint256)
        internal pure override
        returns (uint256[] memory outcomes)
    {
        outcomes = new uint256[](1);
        outcomes[0] = 0; // packed grid of all-zero symbols (all Cherry), no payline hit
    }

    function _previewRoll(bytes memory, uint256 betAmount, uint256 randomWord)
        internal view override
        returns (uint256 payout, uint256 outcome)
    {
        uint256 cells = uint256(REELS) * ROWS;
        uint8[] memory grid     = new uint8[](cells);
        uint8[] memory wildMult = new uint8[](cells);
        _buildGrid(randomWord, cells, grid, wildMult);
        (uint256 baseWin, uint256 globalMult) = _evaluate(grid, wildMult, betAmount);
        payout  = baseWin * globalMult;
        outcome = _packOutcome(grid, wildMult, cells);
    }

    function _previewExplosionOutcomes(bytes memory, uint16)
        internal pure override
        returns (uint256[] memory outcomes)
    {
        outcomes = new uint256[](1);
        outcomes[0] = 0;
    }

    function _getRefundAmount(uint256 betId) internal view override returns (uint256) {
        BaseBet storage bet = baseBets[betId];
        return bet.amount * bet.betCount;
    }

    /// @dev Unpack grid + wildMult from outcomes[0], recompute globalMultiplier, emit event.
    function _afterBetSettled(
        uint256 betId,
        uint256[] memory outcomes,
        uint256 payout
    ) internal override {
        uint256 cells = uint256(REELS) * ROWS;
        (uint8[] memory grid, uint8[] memory wildMult) = _unpackOutcome(outcomes[0], cells);

        uint256 globalMult = 1;
        for (uint256 i = 0; i < cells; ) {
            if (wildMult[i] > 1) {
                globalMult *= wildMult[i];
                if (globalMult >= MAX_GLOBAL_MULT) {
                    globalMult = MAX_GLOBAL_MULT;
                    break;
                }
            }
            unchecked { ++i; }
        }

        BaseBet storage bet = baseBets[betId];
        emit ModernSlotSpun(
            betId, bet.player, grid, wildMult, globalMult, bet.amount, payout
        );
    }

    // ─── Grid generation ────────────────────────────────────────────────────

    /// @dev Populate grid[] and wildMult[] arrays from a deterministic random seed.
    function _buildGrid(
        uint256 randomWord,
        uint256 cells,
        uint8[] memory grid,
        uint8[] memory wildMult
    ) internal view {
        uint32[7] memory cw = _cumW;
        for (uint256 i = 0; i < cells; ) {
            uint32 r   = uint32(uint256(keccak256(abi.encode(randomWord, i))) % TOTAL_WEIGHT);
            uint8  sym = _symbolFromRandom(cw, r);
            grid[i] = sym;
            if (sym == WILD) {
                wildMult[i] = _wildMultiplier(randomWord, i);
            }
            unchecked { ++i; }
        }
    }

    function _symbolFromRandom(uint32[7] memory cw, uint32 rand)
        internal pure
        returns (uint8)
    {
        for (uint8 s = 0; s < NUM_SYMBOLS; ) {
            if (rand < cw[s]) return s;
            unchecked { ++s; }
        }
        return NUM_SYMBOLS - 1;
    }

    /// @dev WILD multiplier derived deterministically from the roll's randomWord.
    ///      70 % → x2 | 25 % → x3 | 5 % → x5.
    function _wildMultiplier(uint256 randomWord, uint256 cellIdx)
        internal pure
        returns (uint8)
    {
        uint256 r = uint256(keccak256(abi.encode(randomWord, "wild", cellIdx))) % 100;
        if (r < 70) return 2;
        if (r < 95) return 3;
        return 5;
    }

    // ─── Ways-to-win evaluation ─────────────────────────────────────────────

    /// @dev Compute baseWin (before globalMultiplier) and globalMultiplier.
    function _evaluate(
        uint8[] memory grid,
        uint8[] memory wildMult,
        uint256 bet
    ) internal view returns (uint256 totalWin, uint256 globalMultiplier) {
        globalMultiplier = 1;
        uint256 cells = grid.length;

        // Global multiplier: product of all WILD cell multipliers (capped).
        for (uint256 i = 0; i < cells; ) {
            if (grid[i] == WILD && wildMult[i] > 1) {
                globalMultiplier *= wildMult[i];
                if (globalMultiplier >= MAX_GLOBAL_MULT) {
                    globalMultiplier = MAX_GLOBAL_MULT;
                    break;
                }
            }
            unchecked { ++i; }
        }

        uint256 pd = payDenom;
        // Ways-to-win per payable symbol.
        for (uint8 s = 0; s < NUM_PAYABLE; ) {
            uint256 ways   = 1;
            uint256 length = 0;
            for (uint8 reel = 0; reel < REELS; ) {
                uint256 c = _countInReel(grid, reel, s);
                if (c == 0) break;
                ways  *= c;
                length++;
                unchecked { ++reel; }
            }
            if (length >= MIN_MATCH) {
                totalWin += (bet * _payout(s, length) * ways) / pd;
            }
            unchecked { ++s; }
        }
    }

    function _countInReel(uint8[] memory grid, uint8 reel, uint8 symbol)
        internal view
        returns (uint256 count)
    {
        uint256 startIdx = uint256(reel) * ROWS;
        for (uint256 row = 0; row < ROWS; ) {
            uint8 g = grid[startIdx + row];
            if (g == symbol || g == WILD) count++;
            unchecked { ++row; }
        }
    }

    /// @dev Base payout table: base[symbol] × lengthFactor.
    ///      Calibrated for use with payDenom = 1000 on a 5×3 grid (RTP ≈ 97 %).
    ///      Run off-chain simulator (sim/rtp.mjs) when changing grid size or payDenom.
    function _payout(uint8 symbol, uint256 length)
        internal pure
        returns (uint256)
    {
        if (length < MIN_MATCH) return 0;
        uint16[6] memory base = [uint16(2), 5, 12, 40, 150, 600];
        uint256 f;
        if      (length == 3) f = 1;
        else if (length == 4) f = 5;
        else if (length == 5) f = 20;
        else if (length == 6) f = 60;
        else                  f = 150; // 7+
        return uint256(base[symbol]) * f;
    }

    // ─── Packing ────────────────────────────────────────────────────────────

    /// @dev Per cell: bits[0..2] = symbol (0-6), bits[3..4] = encodedWildMult.
    ///      encodedWildMult: 0→none  1→x2  2→x3  3→x5.
    ///      5 bits × 49 cells = 245 bits. Fits in uint256 for any grid up to 7×7.
    function _packOutcome(
        uint8[] memory grid,
        uint8[] memory wildMult,
        uint256 cells
    ) internal pure returns (uint256 packed) {
        for (uint256 i = 0; i < cells; ) {
            uint256 sym = grid[i];
            uint256 wm  = _encodeWildMult(wildMult[i]);
            packed |= (sym | (wm << 3)) << (i * 5);
            unchecked { ++i; }
        }
    }

    function _unpackOutcome(uint256 packed, uint256 cells)
        internal pure
        returns (uint8[] memory grid, uint8[] memory wildMult)
    {
        grid     = new uint8[](cells);
        wildMult = new uint8[](cells);
        for (uint256 i = 0; i < cells; ) {
            uint256 chunk = (packed >> (i * 5)) & 0x1F; // 5 bits
            grid[i]     = uint8(chunk & 0x7);            // lower 3 bits = symbol
            wildMult[i] = _decodeWildMult(uint8(chunk >> 3)); // upper 2 bits
            unchecked { ++i; }
        }
    }

    function _encodeWildMult(uint8 wm) internal pure returns (uint8) {
        if (wm == 2) return 1;
        if (wm == 3) return 2;
        if (wm == 5) return 3;
        return 0;
    }

    function _decodeWildMult(uint8 encoded) internal pure returns (uint8) {
        if (encoded == 1) return 2;
        if (encoded == 2) return 3;
        if (encoded == 3) return 5;
        return 0;
    }

    // ─── View helpers ────────────────────────────────────────────────────────

    /// @notice Encode a slot game choice. Always betCount = 1.
    function encodeGameChoice() external pure returns (bytes memory) {
        return abi.encode(uint16(1));
    }

    /// @notice Decode a packed outcome for off-chain inspection.
    function decodeOutcome(uint256 packed)
        external view
        returns (uint8[] memory grid, uint8[] memory wildMult)
    {
        uint256 cells = uint256(REELS) * ROWS;
        return _unpackOutcome(packed, cells);
    }

    /// @notice Return the current symbol weights (for front-end / auditing).
    function getCumulativeWeights() external view returns (uint32[7] memory) {
        return _cumW;
    }
}
