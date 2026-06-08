// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseGame} from "../base/BaseGame.sol";

/// @title FlipGame - Coin flip: pick a side, win x2 or lose.
contract FlipGame is BaseGame {

    struct FlipBet {
        bool choice; // false = left, true = right
    }

    mapping(uint256 => FlipBet) public flipBets;

    event FlipRoll(
        uint256 indexed betId,
        bool choice,
        uint256[] outcomes,
        uint256 payout
    );

    error InvalidSide();

    constructor(address _treasury) BaseGame(_treasury) {}

    // ──────────────────── Virtuals ────────────────────

    function _decodeBaseChoice(bytes calldata gameChoice)
        internal pure override
        returns (uint16 betCount, bytes memory specificChoice)
    {
        (uint8 side, uint16 count) = abi.decode(gameChoice, (uint8, uint16));
        betCount = count;
        specificChoice = abi.encode(side);
    }

    function _validateGameChoice(bytes memory specificChoice) internal pure override {
        uint8 side = abi.decode(specificChoice, (uint8));
        if (side > 1) revert InvalidSide();
    }

    function _storeGameBet(uint256 betId, bytes memory specificChoice) internal override {
        uint8 side = abi.decode(specificChoice, (uint8));
        flipBets[betId] = FlipBet({choice: side == 1});
    }

    /// @dev Flip pays x2 on win, 0 on loss. No house edge applied (original behavior).
    function _roll(uint256 betId, uint256 betAmount, uint256 randomWord)
        internal view override returns (uint256 payout)
    {
        bool result = (randomWord % 100) < 50;
        bool playerWins = flipBets[betId].choice != result;
        if (playerWins) {
            payout = betAmount * 2;
        }
    }

    /// @dev 0 = left won, 1 = right won
    function _getRollOutcome(uint256 /*betId*/, uint256 randomWord)
        internal pure override returns (uint256 outcome)
    {
        outcome = (randomWord % 100) < 50 ? 0 : 1;
    }

    function _getExplosionOutcomes(uint256 betId)
        internal view override returns (uint256[] memory outcomes)
    {
        FlipBet storage fb = flipBets[betId];
        BaseBet storage bet = baseBets[betId];
        outcomes = new uint256[](bet.betCount);
        uint256 losingOutcome = fb.choice ? 0 : 1;
        for (uint16 i = 0; i < bet.betCount;) {
            outcomes[i] = losingOutcome;
            unchecked { ++i; }
        }
    }

    function _previewRoll(bytes memory specificChoice, uint256 betAmount, uint256 randomWord)
        internal pure override returns (uint256 payout, uint256 outcome)
    {
        uint8 side = abi.decode(specificChoice, (uint8));
        bool choice = side == 1;
        bool result = (randomWord % 100) < 50;
        bool playerWins = choice != result;
        if (playerWins) {
            payout = betAmount * 2;
        }
        outcome = result ? 0 : 1;
    }

    function _previewExplosionOutcomes(bytes memory specificChoice, uint16 betCount)
        internal pure override returns (uint256[] memory outcomes)
    {
        uint8 side = abi.decode(specificChoice, (uint8));
        bool choice = side == 1;
        uint256 losingOutcome = choice ? 0 : 1;
        outcomes = new uint256[](betCount);
        for (uint16 i = 0; i < betCount;) {
            outcomes[i] = losingOutcome;
            unchecked { ++i; }
        }
    }

    /// @dev Flip refunds full amount (no house edge in original).
    function _getRefundAmount(uint256 betId) internal view override returns (uint256) {
        BaseBet storage bet = baseBets[betId];
        return bet.amount * bet.betCount;
    }

    // ──────────────────── View ────────────────────

    function getFlipBet(uint256 betId) external view returns (FlipBet memory) {
        return flipBets[betId];
    }

    function encodeGameChoice(uint8 side, uint16 betCount)
        external pure returns (bytes memory)
    {
        return abi.encode(side, betCount);
    }
}
