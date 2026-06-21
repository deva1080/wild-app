// SPDX-License-Identifier: MIT
// @dev v0.1 beta
pragma solidity ^0.8.28;

import {BaseGame} from "../base/BaseGame.sol";

/// @title HiLoGame - Bet HI or LO against a reference card [1-13].
///
/// ── Mechanics ────────────────────────────────────────────────────────────────
///   The player chooses a reference card (passed as a parameter — no state
///   is stored between plays) and bets whether the drawn card will be
///   strictly HIGHER or strictly LOWER. Ties always lose, EXCEPT at the extremes:
///     card=13 + HI → wins if drawn >= 13  (same or higher — only 13 qualifies)
///     card=1  + LO → wins if drawn <= 1   (same or lower  — only 1 qualifies)
///   Each play is fully atomic and stateless.
///
/// ── gameChoice encoding ──────────────────────────────────────────────────────
///   abi.encode(uint8 card, uint8 direction, uint16 betCount)
///   card      : reference card [1-13]  (1=Ace, 13=King)
///   direction : 0 = LO (drawn < card)  |  1 = HI (drawn > card)
///   betCount  : number of independent draws against the same card
///
/// ── Outcome encoding (outcomes[i] in BetSettled) ────────────────────────────
///   Drawn card value [1-13].
///
/// ── Payout formula ───────────────────────────────────────────────────────────
///   HI probability = (13 - card) / 13   (cards strictly above)
///   LO probability = (card - 1)  / 13   (cards strictly below)
///   fair multiplier = 13 / winningCards
///   applied multiplier = fair × 0.96    (~4% house edge)
///   All card + direction combinations are valid.
///
/// ── House edge ───────────────────────────────────────────────────────────────
///   ~4% embedded in the payout table. explosionRate is set to 0.

contract HiLoGame is BaseGame {

    // ──────────────────── Direction constants ────────────────────

    uint8 public constant DIRECTION_LO = 0;
    uint8 public constant DIRECTION_HI = 1;

    // ──────────────────── Payout tables (x100 basis, 200 = 2x) ──────────────────
    //
    // hiPayouts[card] — multiplier when betting HI against `card`.
    //   Wins if drawn > card. Probability = (13-card)/13.
    //   Payout = floor(13 / (13-card) × 0.96 × 100).
    //   Index 0 unused. Index 13 = impossible (0).
    //
    // loPayouts[card] — perfect mirror. Wins if drawn < card.
    //   Probability = (card-1)/13.

    uint16[14] public hiPayouts;
    uint16[14] public loPayouts;

    // ──────────────────── Structs ────────────────────

    struct HiLoBet {
        uint8 card;      // reference card [1-13]
        uint8 direction; // 0=LO, 1=HI
    }

    mapping(uint256 => HiLoBet) public hiloBets;

    // ──────────────────── Events ────────────────────

    /// @dev outcomes[i] = drawn card value [1-13] for draw i.
    event HiLoRoll(
        uint256 indexed betId,
        uint8   card,
        uint8   direction,
        uint256[] outcomes,
        uint256 payout
    );

    // ──────────────────── Errors ────────────────────

    error InvalidCard();      // card must be [1-13]
    error InvalidDirection(); // direction must be 0 or 1

    // ──────────────────── Constructor ────────────────────

    constructor(address _treasury) BaseGame(_treasury) {
        explosionRate = 0; // edge is in the payout table, not scripted losses
        _initPayouts();
    }

    // ──────────────────── Admin ────────────────────

    /// @notice Update HI payout for a specific reference card [1-13].
    function setHiPayout(uint8 card, uint16 payout) external onlyOwner {
        if (card < 1 || card > 13) revert InvalidCard();
        hiPayouts[card] = payout;
    }

    /// @notice Update LO payout for a specific reference card [1-13].
    function setLoPayout(uint8 card, uint16 payout) external onlyOwner {
        if (card < 1 || card > 13) revert InvalidCard();
        loPayouts[card] = payout;
    }

    // ──────────────────── BaseGame virtuals ────────────────────

    function _decodeBaseChoice(bytes calldata gameChoice)
        internal pure override
        returns (uint16 betCount, bytes memory specificChoice)
    {
        (uint8 card, uint8 direction, uint16 count) = abi.decode(gameChoice, (uint8, uint8, uint16));
        betCount = count;
        specificChoice = abi.encode(card, direction);
    }

    function _validateGameChoice(bytes memory specificChoice) internal pure override {
        (uint8 card, uint8 direction) = abi.decode(specificChoice, (uint8, uint8));
        if (card < 1 || card > 13)    revert InvalidCard();
        if (direction > DIRECTION_HI) revert InvalidDirection();
    }

    function _storeGameBet(uint256 betId, bytes memory specificChoice) internal override {
        (uint8 card, uint8 direction) = abi.decode(specificChoice, (uint8, uint8));
        hiloBets[betId] = HiLoBet({card: card, direction: direction});
    }

    function _roll(uint256 betId, uint256 betAmount, uint256 randomWord)
        internal view override returns (uint256 payout)
    {
        HiLoBet storage hb = hiloBets[betId];
        uint8 drawn = uint8((randomWord % 13) + 1);
        bool won = hb.direction == DIRECTION_HI
            ? (hb.card == 13 ? drawn >= hb.card : drawn > hb.card)
            : (hb.card == 1  ? drawn <= hb.card : drawn < hb.card);
        if (won) {
            uint16 mult = hb.direction == DIRECTION_HI
                ? hiPayouts[hb.card]
                : loPayouts[hb.card];
            payout = betAmount * uint256(mult) / 100;
        }
    }

    /// @dev outcome = drawn card [1-13].
    function _getRollOutcome(uint256 /*betId*/, uint256 randomWord)
        internal pure override returns (uint256 outcome)
    {
        outcome = uint256((randomWord % 13) + 1);
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
        (uint8 card, uint8 direction) = abi.decode(specificChoice, (uint8, uint8));
        uint8 drawn = uint8((randomWord % 13) + 1);
        outcome = uint256(drawn);
        bool won = direction == DIRECTION_HI
            ? (card == 13 ? drawn >= card : drawn > card)
            : (card == 1  ? drawn <= card : drawn < card);
        if (won) {
            uint16 mult = direction == DIRECTION_HI ? hiPayouts[card] : loPayouts[card];
            payout = betAmount * uint256(mult) / 100;
        }
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
        HiLoBet storage hb = hiloBets[betId];
        emit HiLoRoll(betId, hb.card, hb.direction, outcomes, payout);
    }

    // ──────────────────── Internal ────────────────────

    /// @dev Payout = floor(13 / winningCards × 0.96 × 100).
    ///      HI wins if drawn > card  → winningCards = 13 - card
    ///      LO wins if drawn < card  → winningCards = card - 1
    ///      Ties always lose (excluded from winning cards).
    function _initPayouts() internal {
        // HI payouts — ordered card 1→12 (card 13 is impossible, stays 0)
        hiPayouts[1]  = 104;  // 12/13 → fair 1.083x → 1.04x
        hiPayouts[2]  = 113;  // 11/13 → fair 1.182x → 1.13x
        hiPayouts[3]  = 124;  // 10/13 → fair 1.300x → 1.24x
        hiPayouts[4]  = 138;  //  9/13 → fair 1.444x → 1.38x
        hiPayouts[5]  = 156;  //  8/13 → fair 1.625x → 1.56x
        hiPayouts[6]  = 178;  //  7/13 → fair 1.857x → 1.78x
        hiPayouts[7]  = 208;  //  6/13 → fair 2.167x → 2.08x
        hiPayouts[8]  = 249;  //  5/13 → fair 2.600x → 2.49x
        hiPayouts[9]  = 312;  //  4/13 → fair 3.250x → 3.12x
        hiPayouts[10] = 416;  //  3/13 → fair 4.333x → 4.16x
        hiPayouts[11] = 624;  //  2/13 → fair 6.500x → 6.24x
        hiPayouts[12] = 1248; //  1/13 → fair 13.00x → 12.48x
        hiPayouts[13] = 1248; //  1/13 → drawn >= 13 (tie counts) → 12.48x

        // LO payouts — perfect mirror of HI (card 1 is impossible, stays 0)
        loPayouts[1]  = 1248; //  1/13 → drawn <= 1 (tie counts) → 12.48x
        loPayouts[2]  = 1248; //  1/13 → 12.48x
        loPayouts[3]  = 624;  //  2/13 →  6.24x
        loPayouts[4]  = 416;  //  3/13 →  4.16x
        loPayouts[5]  = 312;  //  4/13 →  3.12x
        loPayouts[6]  = 249;  //  5/13 →  2.49x
        loPayouts[7]  = 208;  //  6/13 →  2.08x
        loPayouts[8]  = 178;  //  7/13 →  1.78x
        loPayouts[9]  = 156;  //  8/13 →  1.56x
        loPayouts[10] = 138;  //  9/13 →  1.38x
        loPayouts[11] = 124;  // 10/13 →  1.24x
        loPayouts[12] = 113;  // 11/13 →  1.13x
        loPayouts[13] = 104;  // 12/13 →  1.04x
    }

    // ──────────────────── View ────────────────────

    function getHiLoBet(uint256 betId) external view returns (HiLoBet memory) {
        return hiloBets[betId];
    }

    /// @notice Build the gameChoice bytes off-chain.
    function encodeGameChoice(uint8 card, uint8 direction, uint16 betCount)
        external pure returns (bytes memory)
    {
        return abi.encode(card, direction, betCount);
    }
}
