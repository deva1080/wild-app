// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {BaseGame} from "../base/BaseGame.sol";

/// @title WheelGame - Configurable weighted wheel (Wheel of Fortune, Plinko, etc.)
/// Each config defines colors with weights and multipliers. Supports multi-bet with stopGain/stopLoss.
/// Inherits BaseGame: supports credits, delegated (1-tx) mode, and standard 2-tx mode.
contract WheelGame is BaseGame {

    // ──────────────────── Structs ────────────────────

    struct WheelBet {
        uint32 configId;
        uint256 stopGain;
        uint256 stopLoss;
        uint8[] rolled;
    }

    struct GameConfig {
        uint72[] weightRanges;
        uint64[] multipliers;
        uint64 maxMultiplier;
        uint32 gameId;
    }

    // ──────────────────── Constants ────────────────────

    uint256 internal constant BP_VALUE = 10_000;

    // ──────────────────── State ────────────────────

    uint32 private _configsCount;
    uint8 private _maxColors;

    mapping(uint256 => WheelBet) private _wheelBets;
    mapping(uint32 => GameConfig) private _gameConfigs;
    mapping(uint32 => uint256) public playsPerConfigId;

    // ──────────────────── Events ────────────────────

    event PlaceBet(
        uint256 id,
        address indexed receiver,
        address indexed token,
        uint256 amount,
        uint32 configId,
        uint16 betCount,
        uint256 stopGain,
        uint256 stopLoss
    );

    event Roll(
        uint256 indexed id,
        address indexed receiver,
        address indexed token,
        uint256 totalBetAmount,
        uint32 configId,
        uint8[] rolled,
        uint256 payout
    );

    event GameConfigAdded(
        uint32 configId,
        uint64[] weights,
        uint64[] multipliers,
        uint32 gameId
    );

    event SetMaxColors(uint8 previousMaxColors, uint8 maxColors);

    // ──────────────────── Errors ────────────────────

    error InvalidConfig();
    error ConfigNotExists(uint32 configId);

    // ──────────────────── Constructor ────────────────────

    constructor(address _treasury) BaseGame(_treasury) {}

    // ══════════════════════════════════════════════════════════
    //                   ADMIN: CONFIG
    // ══════════════════════════════════════════════════════════

    function addGameConfig(
        uint64[] calldata weights_,
        uint64[] calldata multipliers_,
        uint32 gameId
    ) external onlyOwner returns (uint32 configId) {
        uint256 totalColors = weights_.length;
        if (totalColors == 0 || totalColors > _maxColors || totalColors != multipliers_.length)
            revert InvalidConfig();

        uint72 totalWeightAmount;
        uint256 totalWeightedMultiplierAmount;
        uint64 maxMul;
        uint72[] memory weightRanges = new uint72[](totalColors);

        for (uint8 i; i < totalColors;) {
            uint64 multiplier = multipliers_[i];
            uint64 weight = weights_[i];
            if (weight == 0) revert InvalidConfig();
            totalWeightAmount += weight;
            totalWeightedMultiplierAmount += uint256(weight) * multiplier;
            if (maxMul < multiplier) maxMul = multiplier;
            weightRanges[i] = i == 0 ? weight : weightRanges[i - 1] + weight;
            unchecked { ++i; }
        }

        uint256 avg = totalWeightedMultiplierAmount / totalWeightAmount;
        if (avg > BP_VALUE) revert InvalidConfig();
        if (avg == BP_VALUE && totalWeightedMultiplierAmount % totalWeightAmount != 0)
            revert InvalidConfig();
        if (maxMul <= BP_VALUE) revert InvalidConfig();

        configId = _configsCount;
        _gameConfigs[configId] = GameConfig(weightRanges, multipliers_, maxMul, gameId);
        ++_configsCount;
        emit GameConfigAdded(configId, weights_, multipliers_, gameId);
    }

    function updateGameConfig(
        uint32 configId,
        uint64[] calldata weights_,
        uint64[] calldata multipliers_,
        uint32 gameId
    ) external onlyOwner {
        uint256 totalColors = weights_.length;
        if (totalColors == 0 || totalColors > _maxColors || totalColors != multipliers_.length)
            revert InvalidConfig();

        GameConfig storage cfg = _gameConfigs[configId];
        if (cfg.weightRanges.length == 0) revert ConfigNotExists(configId);

        uint72 totalWeightAmount;
        uint256 totalWeightedMultiplierAmount;
        uint64 maxMul;
        uint72[] memory weightRanges = new uint72[](totalColors);

        for (uint8 i; i < totalColors;) {
            uint64 multiplier = multipliers_[i];
            uint64 weight = weights_[i];
            if (weight == 0) revert InvalidConfig();
            totalWeightAmount += weight;
            totalWeightedMultiplierAmount += uint256(weight) * multiplier;
            if (maxMul < multiplier) maxMul = multiplier;
            weightRanges[i] = i == 0 ? weight : weightRanges[i - 1] + weight;
            unchecked { ++i; }
        }

        uint256 avg = totalWeightedMultiplierAmount / totalWeightAmount;
        if (avg > BP_VALUE) revert InvalidConfig();
        if (avg == BP_VALUE && totalWeightedMultiplierAmount % totalWeightAmount != 0)
            revert InvalidConfig();
        if (maxMul <= BP_VALUE) revert InvalidConfig();

        cfg.weightRanges = weightRanges;
        cfg.multipliers = multipliers_;
        cfg.maxMultiplier = maxMul;
        cfg.gameId = gameId;

        emit GameConfigAdded(configId, weights_, multipliers_, gameId);
    }

    function setMaxColors(uint8 maxColors_) external onlyOwner {
        uint8 old = _maxColors;
        _maxColors = maxColors_;
        emit SetMaxColors(old, maxColors_);
    }

    // ══════════════════════════════════════════════════════════
    //                OVERRIDES: SETTLE WITH STOP GAIN/LOSS
    // ══════════════════════════════════════════════════════════

    /// @dev Override settleBet to incorporate stopGain/stopLoss logic.
    function settleBet(uint256 betId, uint256 seed) external override onlyCaller {
        BaseBet storage bet = baseBets[betId];
        if (bet.amount == 0 || bet.resolved) revert BetNotPending();

        uint256 baseRandom = _generateRandom(seed, bet.placeBlockNumber);

        if (_checkExplosion(baseRandom)) {
            bet.resolved = true;
            bet.payout = 0;
            pendingBetId[bet.player] = 0;
            uint256[] memory explosionResults = _getExplosionOutcomes(betId);
            emit BetSettled(betId, bet.player, bet.token, bet.amount * bet.betCount, 0, explosionResults);
            return;
        }

        uint256 totalPayout = _resolveWheelBet(betId, baseRandom);

        bet.resolved = true;
        bet.payout = totalPayout;
        pendingBetId[bet.player] = 0;

        if (totalPayout > 0) {
            PlayerInfo storage pi = playerInfo[bet.player];
            pi.totalWins++;
            pi.totalOutValue += totalPayout;
            treasury.withdrawTokens(bet.token, totalPayout, bet.player);
        }
    }

    /// @dev Internal: resolve wheel multi-bet with stopGain/stopLoss for 2-tx mode.
    function _resolveWheelBet(uint256 betId, uint256 baseRandom) internal returns (uint256 totalPayout) {
        BaseBet storage bet = baseBets[betId];
        WheelBet storage wheelBet = _wheelBets[betId];

        uint256 stopGain = wheelBet.stopGain;
        uint256 stopLoss = wheelBet.stopLoss;
        uint16 betCount = bet.betCount;
        uint256 betAmount = bet.amount;

        uint8[] memory rolledColors = new uint8[](betCount);
        uint256 cumulatedPayout;
        uint256 cumulatedBetAmount;
        uint16 rollCount;

        do {
            cumulatedBetAmount += betAmount;
            uint256 rollRandom = uint256(keccak256(abi.encode(baseRandom, rollCount)));
            cumulatedPayout += _roll(betId, betAmount, rollRandom);
            rolledColors[rollCount] = uint8(_getRollOutcome(betId, rollRandom));
            unchecked { ++rollCount; }
        } while (
            rollCount < betCount &&
            !((stopGain > 0 && cumulatedPayout >= stopGain + cumulatedBetAmount) ||
              (stopLoss > 0 && cumulatedBetAmount >= stopLoss + cumulatedPayout))
        );

        if (rollCount < betCount) {
            assembly ("memory-safe") { mstore(rolledColors, rollCount) }
        }

        uint256 refundAmount = betAmount * betCount - cumulatedBetAmount;
        totalPayout = cumulatedPayout + refundAmount;

        wheelBet.rolled = rolledColors;

        uint256[] memory outcomes = new uint256[](rolledColors.length);
        for (uint256 i; i < rolledColors.length;) {
            outcomes[i] = rolledColors[i];
            unchecked { ++i; }
        }
        emit BetSettled(betId, bet.player, bet.token, cumulatedBetAmount, totalPayout, outcomes);
        emit Roll(betId, bet.player, bet.token, cumulatedBetAmount, wheelBet.configId, rolledColors, totalPayout);
    }

    /// @dev Override playAndSettle to incorporate stopGain/stopLoss logic.
    function playAndSettle(
        PlayParams calldata params
    ) external override onlyCaller whenLive returns (uint256 betId, uint256 payout) {
        TokenConfig storage tc = supportedTokenInfo[params.token];
        if (tc.maxBetAmount == 0) revert TokenNotConfigured();

        (uint16 betCount, bytes memory specificChoice) = _decodeBaseChoice(params.gameChoice);
        if (betCount == 0) revert InvalidBetCount();

        uint256 betAmountPerRoll = params.amount / uint256(betCount);
        if (betAmountPerRoll < tc.minBetAmount || betAmountPerRoll > tc.maxBetAmount)
            revert BetAmountOutOfRange();

        _validateGameChoice(specificChoice);

        betId = nextBetId++;

        baseBets[betId] = BaseBet({
            player: params.player,
            token: params.token,
            amount: betAmountPerRoll,
            betCount: betCount,
            placeBlockNumber: uint176(block.number),
            resolved: true,
            isCreditBet: params.isCreditBet,
            payout: 0
        });

        _storeGameBet(betId, specificChoice);

        payout = _resolveWheelAtomically(betId, betCount, betAmountPerRoll, params.seed);
        baseBets[betId].payout = payout;

        _updatePlayerAfterSettle(params.player, params.amount, payout);

        if (payout > 0) {
            treasury.withdrawTokens(params.token, payout, params.player);
        }

        totalBetsGlobal++;
        totalValueGlobal += params.amount;
    }

    /// @dev Internal helper to resolve the wheel rolls atomically (reduces stack depth).
    function _resolveWheelAtomically(
        uint256 betId,
        uint16 betCount,
        uint256 betAmountPerRoll,
        uint256 seed
    ) internal returns (uint256 payout) {
        uint256 baseRandom = uint256(keccak256(abi.encode(
            seed, block.timestamp, block.prevrandao, blockhash(block.number - 1)
        )));

        WheelBet storage wheelBet = _wheelBets[betId];

        if (_checkExplosion(baseRandom)) {
            wheelBet.rolled = new uint8[](betCount);
            emit BetSettled(betId, baseBets[betId].player, baseBets[betId].token, betAmountPerRoll * betCount, 0, new uint256[](betCount));
            return 0;
        }

        uint256 stopGain = wheelBet.stopGain;
        uint256 stopLoss = wheelBet.stopLoss;
        uint8[] memory rolledColors = new uint8[](betCount);
        uint256 cumulatedPayout;
        uint256 cumulatedBetAmount;
        uint16 rollCount;

        do {
            cumulatedBetAmount += betAmountPerRoll;
            uint256 rollRandom = uint256(keccak256(abi.encode(baseRandom, rollCount)));
            cumulatedPayout += _roll(betId, betAmountPerRoll, rollRandom);
            rolledColors[rollCount] = uint8(_getRollOutcome(betId, rollRandom));
            unchecked { ++rollCount; }
        } while (
            rollCount < betCount &&
            !((stopGain > 0 && cumulatedPayout >= stopGain + cumulatedBetAmount) ||
              (stopLoss > 0 && cumulatedBetAmount >= stopLoss + cumulatedPayout))
        );

        if (rollCount < betCount) {
            assembly ("memory-safe") { mstore(rolledColors, rollCount) }
        }

        uint256 refundAmount = betAmountPerRoll * betCount - cumulatedBetAmount;
        payout = cumulatedPayout + refundAmount;

        wheelBet.rolled = rolledColors;

        uint256[] memory outcomes = new uint256[](rolledColors.length);
        for (uint256 i; i < rolledColors.length;) {
            outcomes[i] = rolledColors[i];
            unchecked { ++i; }
        }
        emit BetSettled(betId, baseBets[betId].player, baseBets[betId].token, cumulatedBetAmount, payout, outcomes);
        emit Roll(betId, baseBets[betId].player, baseBets[betId].token, cumulatedBetAmount, wheelBet.configId, rolledColors, payout);
    }

    // ══════════════════════════════════════════════════════════
    //                  BASEGAME VIRTUALS
    // ══════════════════════════════════════════════════════════

    /// @dev gameChoice = abi.encode(uint32 configId, uint16 betCount, uint256 stopGain, uint256 stopLoss)
    function _decodeBaseChoice(bytes calldata gameChoice)
        internal pure override
        returns (uint16 betCount, bytes memory specificChoice)
    {
        (uint32 configId, uint16 count, uint256 stopGain, uint256 stopLoss) =
            abi.decode(gameChoice, (uint32, uint16, uint256, uint256));
        betCount = count;
        specificChoice = abi.encode(configId, stopGain, stopLoss);
    }

    function _validateGameChoice(bytes memory specificChoice) internal view override {
        (uint32 configId,,) = abi.decode(specificChoice, (uint32, uint256, uint256));
        uint256 totalColors = _gameConfigs[configId].weightRanges.length;
        if (totalColors == 0) revert ConfigNotExists(configId);
        if (totalColors > _maxColors) revert InvalidConfig();
    }

    function _storeGameBet(uint256 betId, bytes memory specificChoice) internal override {
        (uint32 configId, uint256 stopGain, uint256 stopLoss) =
            abi.decode(specificChoice, (uint32, uint256, uint256));
        _wheelBets[betId].configId = configId;
        _wheelBets[betId].stopGain = stopGain;
        _wheelBets[betId].stopLoss = stopLoss;
        unchecked { ++playsPerConfigId[configId]; }
    }

    /// @dev Single roll: returns payout based on weighted random color.
    function _roll(uint256 betId, uint256 betAmount, uint256 randomWord)
        internal view override returns (uint256 payout)
    {
        uint32 configId = _wheelBets[betId].configId;
        uint72[] storage weightRanges = _gameConfigs[configId].weightRanges;
        uint8 totalColors = uint8(weightRanges.length);

        uint72 rolledWeight = uint72(randomWord % weightRanges[totalColors - 1]);
        uint256 rolled;

        if (totalColors <= 9) {
            if (rolledWeight < weightRanges[0]) rolled = 0;
            else if (rolledWeight < weightRanges[1]) rolled = 1;
            else if (rolledWeight < weightRanges[2]) rolled = 2;
            else if (rolledWeight < weightRanges[3]) rolled = 3;
            else if (rolledWeight < weightRanges[4]) rolled = 4;
            else if (rolledWeight < weightRanges[5]) rolled = 5;
            else if (rolledWeight < weightRanges[6]) rolled = 6;
            else if (rolledWeight < weightRanges[7]) rolled = 7;
            else rolled = 8;
        } else {
            uint8 low;
            uint8 high = totalColors - 1;
            while (low < high) {
                uint8 mid = (low + high) / 2;
                if (rolledWeight >= weightRanges[mid]) {
                    unchecked { low = mid + 1; }
                } else {
                    high = mid;
                }
            }
            rolled = low;
        }

        payout = (betAmount * _gameConfigs[configId].multipliers[rolled]) / BP_VALUE;
    }

    function _getRollOutcome(uint256 betId, uint256 randomWord)
        internal view override returns (uint256 outcome)
    {
        uint32 configId = _wheelBets[betId].configId;
        uint72[] storage weightRanges = _gameConfigs[configId].weightRanges;
        uint8 totalColors = uint8(weightRanges.length);
        uint72 rolledWeight = uint72(randomWord % weightRanges[totalColors - 1]);

        if (totalColors <= 9) {
            if (rolledWeight < weightRanges[0]) outcome = 0;
            else if (rolledWeight < weightRanges[1]) outcome = 1;
            else if (rolledWeight < weightRanges[2]) outcome = 2;
            else if (rolledWeight < weightRanges[3]) outcome = 3;
            else if (rolledWeight < weightRanges[4]) outcome = 4;
            else if (rolledWeight < weightRanges[5]) outcome = 5;
            else if (rolledWeight < weightRanges[6]) outcome = 6;
            else if (rolledWeight < weightRanges[7]) outcome = 7;
            else outcome = 8;
        } else {
            uint8 low;
            uint8 high = totalColors - 1;
            while (low < high) {
                uint8 mid = (low + high) / 2;
                if (rolledWeight >= weightRanges[mid]) {
                    unchecked { low = mid + 1; }
                } else {
                    high = mid;
                }
            }
            outcome = low;
        }
    }

    function _getExplosionOutcomes(uint256 betId)
        internal view override returns (uint256[] memory outcomes)
    {
        outcomes = new uint256[](baseBets[betId].betCount);
    }

    // ══════════════════════════════════════════════════════════
    //                     VIEW FUNCTIONS
    // ══════════════════════════════════════════════════════════

    function maxColors() external view returns (uint8) {
        return _maxColors;
    }

    function configsCount() external view returns (uint32) {
        return _configsCount;
    }

    function gameConfigs(uint32 configId) external view returns (GameConfig memory) {
        return _gameConfigs[configId];
    }

    function wheelBets(uint256 betId) external view returns (WheelBet memory) {
        return _wheelBets[betId];
    }

    function playsPerConfigIds(uint32[] calldata configIds) external view returns (uint256[] memory counts) {
        uint256 l = configIds.length;
        counts = new uint256[](l);
        for (uint256 i; i < l;) {
            counts[i] = playsPerConfigId[configIds[i]];
            unchecked { ++i; }
        }
    }

    function encodeGameChoice(
        uint32 configId,
        uint16 betCount,
        uint256 stopGain,
        uint256 stopLoss
    ) external pure returns (bytes memory) {
        return abi.encode(configId, betCount, stopGain, stopLoss);
    }

    function decodeGameChoice(bytes calldata gameChoice)
        external pure returns (uint32 configId, uint16 betCount, uint256 stopGain, uint256 stopLoss)
    {
        return abi.decode(gameChoice, (uint32, uint16, uint256, uint256));
    }
}
