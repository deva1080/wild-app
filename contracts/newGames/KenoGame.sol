// SPDX-License-Identifier: MIT
// @dev v0.1 beta
pragma solidity ^0.8.28;

import {BaseGame} from "../base/BaseGame.sol";

/// @title KenoGame - Pick 1-10 numbers from [1-40]; 20 are drawn. Win by matching picks.
///
/// ── gameChoice encoding ──────────────────────────────────────────────────────
///   abi.encode(uint40 picksMask, uint16 betCount)
///   picksMask : 40-bit bitmask — bit (n-1) set means number n is picked.
///               e.g. picking {1, 3, 7} → 0b...001000101 = 0x45
///   betCount  : number of independent draws using the same picks.
///
/// ── Outcome encoding (outcomes[i] in BetSettled) ────────────────────────────
///   uint40 draw mask packed into uint256.
///   Bit (n-1) set means number n was drawn.
///   Frontend: popcount(picksMask & drawMask) = hits for that draw.
///   Explosion: fixed mask 0xFFFFF (numbers 1-20).
///
/// ── House edge ───────────────────────────────────────────────────────────────
///   ~4% embedded in the payout table (casino values × 0.96).
///   explosionRate is set to 0 in the constructor — faking a coherent losing draw
///   when the player picked specific numbers is impractical and misleading.
///
/// ── Draw algorithm ───────────────────────────────────────────────────────────
///   Partial Fisher-Yates shuffle over [1-40], selecting 20 numbers.
///   20 keccak256 calls per draw, one per selected number.

contract KenoGame is BaseGame {

    // ──────────────────── Config ────────────────────

    uint8 public maxPicks = 10;

    /// @notice payoutTable[numPicks][hits] — multiplier in x100 basis (200 = 2x, 0 = no win).
    mapping(uint8 => mapping(uint8 => uint32)) public payoutTable;

    // ──────────────────── Structs ────────────────────

    struct KenoBet {
        uint40 picksMask;
        uint8  numPicks;
    }

    mapping(uint256 => KenoBet) public kenoBets;

    // ──────────────────── Events ────────────────────

    /// @dev Emitted via _afterBetSettled for every settled Keno bet.
    ///      outcomes[i] = uint40 draw mask for draw i.
    event KenoRoll(
        uint256 indexed betId,
        uint40  picksMask,
        uint8   numPicks,
        uint256[] outcomes,
        uint256 payout
    );

    // ──────────────────── Errors ────────────────────

    error NoPicks();
    error TooManyPicks();
    error InvalidConfig();

    // ──────────────────── Constructor ────────────────────

    constructor(address _treasury) BaseGame(_treasury) {
        explosionRate = 0; // edge is in the payout table, not scripted losses
        _initDefaultPayouts();
    }

    // ──────────────────── Admin ────────────────────

    function setMaxPicks(uint8 _max) external onlyOwner {
        if (_max == 0 || _max > 10) revert InvalidConfig();
        maxPicks = _max;
    }

    /// @notice Update a single cell in the payout table.
    /// @param numPicks Number of picks the player chose [1-10].
    /// @param hits     Number of matched numbers [0-numPicks].
    /// @param mult     Multiplier in x100 basis (200 = 2x, 0 = no win).
    function setPayout(uint8 numPicks, uint8 hits, uint32 mult) external onlyOwner {
        if (numPicks == 0 || numPicks > 10 || hits > numPicks) revert InvalidConfig();
        payoutTable[numPicks][hits] = mult;
    }

    // ──────────────────── BaseGame virtuals ────────────────────

    function _decodeBaseChoice(bytes calldata gameChoice)
        internal pure override
        returns (uint16 betCount, bytes memory specificChoice)
    {
        (uint40 picksMask, uint16 count) = abi.decode(gameChoice, (uint40, uint16));
        betCount = count;
        specificChoice = abi.encode(picksMask);
    }

    function _validateGameChoice(bytes memory specificChoice) internal view override {
        uint40 picksMask = abi.decode(specificChoice, (uint40));
        if (picksMask == 0) revert NoPicks();
        uint8 numPicks = _countBits(picksMask);
        if (numPicks > maxPicks) revert TooManyPicks();
    }

    function _storeGameBet(uint256 betId, bytes memory specificChoice) internal override {
        uint40 picksMask = abi.decode(specificChoice, (uint40));
        kenoBets[betId] = KenoBet({
            picksMask: picksMask,
            numPicks:  _countBits(picksMask)
        });
    }

    function _roll(uint256 betId, uint256 betAmount, uint256 randomWord)
        internal view override returns (uint256 payout)
    {
        KenoBet storage kb = kenoBets[betId];
        uint40 drawMask = _drawNumbers(randomWord);
        uint8  hits     = _countBits(kb.picksMask & drawMask);
        uint32 mult     = payoutTable[kb.numPicks][hits];
        payout = betAmount * uint256(mult) / 100;
    }

    /// @dev outcome = uint40 draw mask packed into uint256.
    function _getRollOutcome(uint256 /*betId*/, uint256 randomWord)
        internal pure override returns (uint256 outcome)
    {
        outcome = uint256(_drawNumbers(randomWord));
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
        uint40 picksMask = abi.decode(specificChoice, (uint40));
        uint8  numPicks  = _countBits(picksMask);
        uint40 drawMask  = _drawNumbers(randomWord);
        uint8  hits      = _countBits(picksMask & drawMask);
        uint32 mult      = payoutTable[numPicks][hits];
        payout  = betAmount * uint256(mult) / 100;
        outcome = uint256(drawMask);
    }

    /// @dev Never called — explosionRate is 0. Required stub for BaseGame.
    function _previewExplosionOutcomes(bytes memory /*specificChoice*/, uint16 betCount)
        internal pure override returns (uint256[] memory outcomes)
    {
        outcomes = new uint256[](betCount);
    }

    function _afterBetSettled(
        uint256 betId,
        uint256[] memory outcomes,
        uint256 payout
    ) internal override {
        KenoBet storage kb = kenoBets[betId];
        emit KenoRoll(betId, kb.picksMask, kb.numPicks, outcomes, payout);
    }

    // ──────────────────── Internal helpers ────────────────────

    /// @dev Partial Fisher-Yates shuffle: draws 20 unique numbers from [1-40].
    ///      Returns a uint40 bitmask (bit n-1 = number n was drawn).
    ///      20 keccak256 rounds; pool lives in memory only.
    function _drawNumbers(uint256 seed) internal pure returns (uint40 drawn) {
        uint8[40] memory pool;
        unchecked {
            for (uint8 i = 0; i < 40; i++) pool[i] = i + 1;

            uint256 rng = seed;
            for (uint8 i = 0; i < 20; i++) {
                rng = uint256(keccak256(abi.encode(rng, i)));
                // j is uniform in [i, 39]
                uint8 j = uint8(i + uint8(rng % uint256(40 - i)));
                (pool[i], pool[j]) = (pool[j], pool[i]);
                drawn |= uint40(1) << (pool[i] - 1);
            }
        }
    }

    /// @dev Popcount via Brian Kernighan's method.
    function _countBits(uint40 x) internal pure returns (uint8 count) {
        unchecked {
            while (x != 0) {
                x &= x - 1;
                ++count;
            }
        }
    }

    /// @dev Default payout table — casino Keno values × 0.96 (~4% edge, x100 basis).
    function _initDefaultPayouts() internal {
        // ── 1 pick ─────────────────────────────────────────
        payoutTable[1][1] = 268;       // 2.68x  (was 2.8x)

        // ── 2 picks ────────────────────────────────────────
        payoutTable[2][2] = 1152;      // 11.52x (was 12x)

        // ── 3 picks ────────────────────────────────────────
        payoutTable[3][2] = 192;       // 1.92x  (was 2x)
        payoutTable[3][3] = 4416;      // 44.16x (was 46x)

        // ── 4 picks ────────────────────────────────────────
        payoutTable[4][2] = 96;        // 0.96x  (was 1x)
        payoutTable[4][3] = 480;       // 4.8x   (was 5x)
        payoutTable[4][4] = 9600;      // 96x    (was 100x)

        // ── 5 picks ────────────────────────────────────────
        payoutTable[5][3] = 288;       // 2.88x  (was 3x)
        payoutTable[5][4] = 1152;      // 11.52x (was 12x)
        payoutTable[5][5] = 48000;     // 480x   (was 500x)

        // ── 6 picks ────────────────────────────────────────
        payoutTable[6][3] = 192;       // 1.92x  (was 2x)
        payoutTable[6][4] = 672;       // 6.72x  (was 7x)
        payoutTable[6][5] = 9600;      // 96x    (was 100x)
        payoutTable[6][6] = 192000;    // 1920x  (was 2000x)

        // ── 7 picks ────────────────────────────────────────
        payoutTable[7][4] = 288;       // 2.88x  (was 3x)
        payoutTable[7][5] = 1920;      // 19.2x  (was 20x)
        payoutTable[7][6] = 38400;     // 384x   (was 400x)
        payoutTable[7][7] = 672000;    // 6720x  (was 7000x)

        // ── 8 picks ────────────────────────────────────────
        payoutTable[8][5] = 960;       // 9.6x   (was 10x)
        payoutTable[8][6] = 9600;      // 96x    (was 100x)
        payoutTable[8][7] = 192000;    // 1920x  (was 2000x)
        payoutTable[8][8] = 1920000;   // 19200x (was 20000x, capped by maxBetAmount)

        // ── 9 picks ────────────────────────────────────────
        payoutTable[9][5] = 480;       // 4.8x   (was 5x)
        payoutTable[9][6] = 4800;      // 48x    (was 50x)
        payoutTable[9][7] = 48000;     // 480x   (was 500x)
        payoutTable[9][8] = 480000;    // 4800x  (was 5000x)
        payoutTable[9][9] = 4800000;   // 48000x (was 50000x, capped by maxBetAmount)

        // ── 10 picks ───────────────────────────────────────
        payoutTable[10][5]  = 192;     // 1.92x  (was 2x)
        payoutTable[10][6]  = 1920;    // 19.2x  (was 20x)
        payoutTable[10][7]  = 19200;   // 192x   (was 200x)
        payoutTable[10][8]  = 192000;  // 1920x  (was 2000x)
        payoutTable[10][9]  = 1920000; // 19200x (was 20000x, capped by maxBetAmount)
        payoutTable[10][10] = 9600000; // 96000x (was 100000x, capped by maxBetAmount)
    }

    // ──────────────────── View ────────────────────

    function getKenoBet(uint256 betId) external view returns (KenoBet memory) {
        return kenoBets[betId];
    }

    /// @notice Build the gameChoice bytes off-chain from a human-readable picks array.
    /// @param picks  Each entry is a number [1-40]. No duplicates.
    function encodeGameChoice(uint8[] calldata picks, uint16 betCount)
        external pure returns (bytes memory)
    {
        uint40 mask;
        for (uint256 i = 0; i < picks.length; i++) {
            require(picks[i] >= 1 && picks[i] <= 40, "Pick out of range");
            mask |= uint40(1) << (picks[i] - 1);
        }
        return abi.encode(mask, betCount);
    }

    /// @notice Decode a draw mask back into a sorted array of drawn numbers.
    function decodeMask(uint40 mask) external pure returns (uint8[] memory numbers) {
        uint8 count = _countBits(mask);
        numbers = new uint8[](count);
        uint8 idx;
        for (uint8 i = 0; i < 40;) {
            if (mask & (uint40(1) << i) != 0) {
                numbers[idx++] = i + 1;
            }
            unchecked { ++i; }
        }
    }
}
