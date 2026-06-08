// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseGame} from "../base/BaseGame.sol";

contract CrashGame is BaseGame {

    struct CrashBet {
        uint40 multiplierChoice;
    }

    uint256 public minMultiplier = 100;
    uint256 public maxMultiplier = 10000;

    mapping(uint256 => CrashBet) public crashBets;

    event CrashRoll(
        uint256 indexed betId,
        uint40 multiplierChoice,
        uint256[] outcomes,
        uint256 payout
    );

    error MultiplierNotInRange();

    constructor(address _treasury) BaseGame(_treasury) {}

    // ──────────────────── Admin ────────────────────

    function setMinMultiplier(uint256 _minMultiplier) external onlyOwner {
        minMultiplier = _minMultiplier;
    }

    function setMaxMultiplier(uint256 _maxMultiplier) external onlyOwner {
        maxMultiplier = _maxMultiplier;
    }

    // ──────────────────── Virtuals ────────────────────

    function _decodeBaseChoice(bytes calldata gameChoice)
        internal pure override
        returns (uint16 betCount, bytes memory specificChoice)
    {
        (uint256 multiplierChoice, uint16 count) = abi.decode(gameChoice, (uint256, uint16));
        betCount = count;
        specificChoice = abi.encode(multiplierChoice);
    }

    function _validateGameChoice(bytes memory specificChoice) internal view override {
        uint256 multiplierChoice = abi.decode(specificChoice, (uint256));
        if (multiplierChoice <= minMultiplier || multiplierChoice > maxMultiplier) {
            revert MultiplierNotInRange();
        }
    }

    function _storeGameBet(uint256 betId, bytes memory specificChoice) internal override {
        uint256 multiplierChoice = abi.decode(specificChoice, (uint256));
        crashBets[betId] = CrashBet({multiplierChoice: uint40(multiplierChoice)});
    }

    function _roll(uint256 betId, uint256 betAmount, uint256 randomWord)
        internal view override returns (uint256 payout)
    {
        CrashBet storage cb = crashBets[betId];
        uint256 multiplierOutcome = _computeMultiplier(randomWord);

        if (cb.multiplierChoice <= multiplierOutcome) {
            payout = betAmount * cb.multiplierChoice / 100;
        }
    }

    function _getRollOutcome(uint256 /*betId*/, uint256 randomWord)
        internal view override returns (uint256 outcome)
    {
        outcome = _computeMultiplier(randomWord);
    }

    function _getExplosionOutcomes(uint256 betId)
        internal view override returns (uint256[] memory outcomes)
    {
        outcomes = new uint256[](baseBets[betId].betCount);
    }

    function _previewRoll(bytes memory specificChoice, uint256 betAmount, uint256 randomWord)
        internal view override returns (uint256 payout, uint256 outcome)
    {
        uint256 multiplierChoice = abi.decode(specificChoice, (uint256));
        outcome = _computeMultiplier(randomWord);
        if (multiplierChoice <= outcome) {
            payout = betAmount * multiplierChoice / 100;
        }
    }

    function _previewExplosionOutcomes(bytes memory /*specificChoice*/, uint16 betCount)
        internal pure override returns (uint256[] memory outcomes)
    {
        outcomes = new uint256[](betCount);
    }

    function _getRefundAmount(uint256 betId) internal view override returns (uint256) {
        BaseBet storage bet = baseBets[betId];
        return bet.amount * bet.betCount;
    }

    // ──────────────────── Internal ────────────────────

    function _computeMultiplier(uint256 randomWord) private view returns (uint256) {
          // E es un número grande para tener buena precisión
        uint256 E = 1000000;
        
        // H es un número uniforme entre 0 y E-1
        uint256 H = randomWord % E;
        
        // Fórmula estándar: (100 * E) / (E - H)
        // El 100 inicial es porque el multiplicador base es 100 (1.00x)
        uint256 multiplier = (100 * E) / (E - H);
        
        // Clampear entre minMultiplier y maxMultiplier
        if (multiplier < minMultiplier) {
            return minMultiplier;
        }
        if (multiplier > maxMultiplier) {
            return maxMultiplier;
        }
        
        return multiplier;
    }

    // ──────────────────── View ────────────────────

    function getCrashBet(uint256 betId) external view returns (CrashBet memory) {
        return crashBets[betId];
    }

    function encodeGameChoice(uint256 multiplierChoice, uint16 betCount)
        external pure returns (bytes memory)
    {
        return abi.encode(multiplierChoice, betCount);
    }
}
