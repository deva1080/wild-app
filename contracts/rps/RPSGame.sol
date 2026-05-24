// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseGame} from "../base/BaseGame.sol";

/// @title RPSGame - Rock Paper Scissors: 0=Rock, 1=Paper, 2=Scissors.
/// Win pays x2. Draw returns the bet amount.
contract RPSGame is BaseGame {

    struct RPSBet {
        uint8 choice; // 0=Rock, 1=Paper, 2=Scissors
    }

    mapping(uint256 => RPSBet) public rpsBets;

    event RPSRoll(
        uint256 indexed betId,
        uint8 choice,
        uint256[] outcomes,
        uint256 payout
    );

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
        require(side <= 2, "Invalid side");
    }

    function _storeGameBet(uint256 betId, bytes memory specificChoice) internal override {
        uint8 side = abi.decode(specificChoice, (uint8));
        rpsBets[betId] = RPSBet({choice: side});
    }

    /// @dev RPS logic: win = x2, draw = return bet, loss = 0.
    /// Outcome encoding: 0=Rock, 1=Paper, 2=Scissors, 3=Draw (opponent same).
    function _roll(uint256 betId, uint256 betAmount, uint256 randomWord)
        internal view override returns (uint256 payout)
    {
        uint8 choice = rpsBets[betId].choice;
        uint256 opponentRaw = randomWord % 3;

        if (choice == opponentRaw) {
            // Draw: return bet amount
            payout = betAmount;
        } else if (_playerWins(choice, uint8(opponentRaw))) {
            payout = betAmount * 2;
        }
    }

    /// @dev Outcome: 0=Rock, 1=Paper, 2=Scissors; 3 if draw.
    function _getRollOutcome(uint256 betId, uint256 randomWord)
        internal view override returns (uint256 outcome)
    {
        uint8 choice = rpsBets[betId].choice;
        uint256 opponentRaw = randomWord % 3;
        if (choice == opponentRaw) {
            outcome = 3; // draw
        } else {
            outcome = opponentRaw;
        }
    }

    function _getExplosionOutcomes(uint256 betId)
        internal view override returns (uint256[] memory outcomes)
    {
        RPSBet storage rb = rpsBets[betId];
        BaseBet storage bet = baseBets[betId];
        outcomes = new uint256[](bet.betCount);
        // On explosion, show opponent as the choice that beats the player
        uint8 losingOutcome;
        if (rb.choice == 0) losingOutcome = 1;       // Rock loses to Paper
        else if (rb.choice == 1) losingOutcome = 2;   // Paper loses to Scissors
        else losingOutcome = 0;                        // Scissors loses to Rock
        for (uint16 i = 0; i < bet.betCount;) {
            outcomes[i] = losingOutcome;
            unchecked { ++i; }
        }
    }

    // ──────────────────── Internal ────────────────────

    function _playerWins(uint8 player, uint8 opponent) private pure returns (bool) {
        return (player == 0 && opponent == 2)  // Rock beats Scissors
            || (player == 1 && opponent == 0)  // Paper beats Rock
            || (player == 2 && opponent == 1); // Scissors beats Paper
    }

    // ──────────────────── View ────────────────────

    function getRPSBet(uint256 betId) external view returns (RPSBet memory) {
        return rpsBets[betId];
    }

    function encodeGameChoice(uint8 side, uint16 betCount)
        external pure returns (bytes memory)
    {
        return abi.encode(side, betCount);
    }
}
