// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITreasury} from "../interfaces/ITreasury.sol";
import {IBaseGame} from "./IBaseGame.sol";
import {GameCredits} from "./GameCredits.sol";

abstract contract BaseGame is Ownable, IBaseGame {

    // ──────────────────── Structs ────────────────────

    struct TokenConfig {
        uint128 minBetAmount;
        uint128 maxBetAmount;
    }

    struct BaseBet {
        address player;
        address token;
        uint256 amount;
        uint16 betCount;
        uint176 placeBlockNumber;
        bool resolved;
        bool isCreditBet;
        uint256 payout;
    }

    struct PlayerInfo {
        uint32 totalBets;
        uint32 totalWins;
        uint256 totalInValue;
        uint256 totalOutValue;
        uint256[20] lastBetIds;
        uint8 lastBetIdx;
    }

    // ──────────────────── State ────────────────────

    uint256 internal constant NO_GAME_IDENTIFIER = 999_999_999_999;

    ITreasury public treasury;
    GameCredits public gameCredits;
    uint256 public explosionRate;
    bool public gameIsLive;

    mapping(address => bool) public callers;
    mapping(address => TokenConfig) public supportedTokenInfo;
    mapping(address => uint256) public pendingBetId;
    mapping(address => uint256) public playerSeeds;

    uint256 public nextBetId;
    uint256 public totalBetsGlobal;
    uint256 public totalValueGlobal;

    mapping(uint256 => BaseBet) public baseBets;
    mapping(address => PlayerInfo) public playerInfo;

    // ──────────────────── Events ────────────────────

    event BetPlaced(
        uint256 indexed betId,
        address indexed player,
        address token,
        uint256 amount,
        uint16 betCount,
        bytes gameChoice
    );

    event BetSettled(
        uint256 indexed betId,
        address indexed player,
        address token,
        uint256 totalBetAmount,
        uint256 payout,
        uint256[] outcomes
    );

    event BetRefunded(
        uint256 indexed betId,
        address indexed player,
        uint256 amount,
        address token
    );

    event LivePayout(
        address indexed player,
        address indexed game,
        address indexed currency,
        uint256 gameIdentifier,
        uint256 payout
    );

    // ──────────────────── Errors ────────────────────

    error GameNotLive();
    error NotAuthorizedCaller();
    error TokenNotConfigured();
    error BetAmountOutOfRange();
    error PlayerHasPendingBet();
    error InvalidBetCount();
    error BetNotPending();
    error RefundTooEarly();
    error BetDoesNotExist();
    error InsufficientBalance();

    // ──────────────────── Modifiers ────────────────────

    modifier onlyCaller() {
        if (!callers[msg.sender]) revert NotAuthorizedCaller();
        _;
    }

    modifier whenLive() {
        if (!gameIsLive) revert GameNotLive();
        _;
    }

    // ──────────────────── Constructor ────────────────────

    constructor(address _treasury) Ownable(msg.sender) {
        treasury = ITreasury(_treasury);
        nextBetId = 1;
        explosionRate = 4;
    }

    function setPlayerSeed(uint256 newSeed) external {
        playerSeeds[msg.sender] = newSeed;
    }

    // ──────────────────── Admin ────────────────────

    function setCaller(address _caller, bool _allowed) external onlyOwner {
        callers[_caller] = _allowed;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = ITreasury(_treasury);
    }

    function setExplosionRate(uint256 _explosionRate) external onlyOwner {
        explosionRate = _explosionRate;
    }

    function setTokenConfig(
        address token,
        uint128 minBet,
        uint128 maxBet
    ) external onlyOwner {
        supportedTokenInfo[token] = TokenConfig(minBet, maxBet);
    }

    function toggleGameIsLive() external onlyOwner {
        gameIsLive = !gameIsLive;
    }

    function setGameCredits(address _gameCredits) external onlyOwner {
        gameCredits = GameCredits(_gameCredits);
    }

    function withdrawCustomTokenFunds(
        address beneficiary,
        uint256 amount,
        address token
    ) external onlyOwner {
        if (amount > IERC20(token).balanceOf(address(this))) revert InsufficientBalance();
        IERC20(token).transfer(beneficiary, amount);
    }

    // ──────────────────── Play (called by GameRouter) ────────────────────

    function playFromRouter(
        address player,
        bytes calldata gameChoice,
        address token,
        uint256 amount
    ) external override onlyCaller whenLive returns (uint256 betId) {
        TokenConfig storage tc = supportedTokenInfo[token];
        if (tc.maxBetAmount == 0) revert TokenNotConfigured();

        (uint16 betCount, bytes memory specificChoice) = _decodeBaseChoice(gameChoice);
        if (betCount == 0) revert InvalidBetCount();

        uint256 betAmountPerRoll = amount / uint256(betCount);
        if (betAmountPerRoll < tc.minBetAmount || betAmountPerRoll > tc.maxBetAmount)
            revert BetAmountOutOfRange();

        if (pendingBetId[player] != 0) revert PlayerHasPendingBet();

        _validateGameChoice(specificChoice);

        betId = nextBetId++;
        pendingBetId[player] = betId;

        baseBets[betId] = BaseBet({
            player: player,
            token: token,
            amount: betAmountPerRoll,
            betCount: betCount,
            placeBlockNumber: uint176(block.number),
            resolved: false,
            isCreditBet: false,
            payout: 0
        });

        _storeGameBet(betId, specificChoice);

        PlayerInfo storage pi = playerInfo[player];
        pi.totalBets++;
        pi.totalInValue += amount;
        pi.lastBetIds[pi.lastBetIdx] = betId;
        unchecked {
            pi.lastBetIdx = pi.lastBetIdx == 19 ? 0 : pi.lastBetIdx + 1;
        }

        totalBetsGlobal++;
        totalValueGlobal += amount;

        emit BetPlaced(betId, player, token, amount, betCount, gameChoice);
    }

    // ──────────────────── Play with credits (called by GameRouter) ────────────────────

    function playFromRouterWithCredits(
        address player,
        bytes calldata gameChoice,
        address token,
        uint256 amount
    ) external override onlyCaller whenLive returns (uint256 betId) {
        TokenConfig storage tc = supportedTokenInfo[token];
        if (tc.maxBetAmount == 0) revert TokenNotConfigured();

        (uint16 betCount, bytes memory specificChoice) = _decodeBaseChoice(gameChoice);
        if (betCount == 0) revert InvalidBetCount();

        uint256 betAmountPerRoll = amount / uint256(betCount);
        if (betAmountPerRoll < tc.minBetAmount || betAmountPerRoll > tc.maxBetAmount)
            revert BetAmountOutOfRange();

        if (pendingBetId[player] != 0) revert PlayerHasPendingBet();

        _validateGameChoice(specificChoice);

        betId = nextBetId++;
        pendingBetId[player] = betId;

        baseBets[betId] = BaseBet({
            player: player,
            token: token,
            amount: betAmountPerRoll,
            betCount: betCount,
            placeBlockNumber: uint176(block.number),
            resolved: false,
            isCreditBet: true,
            payout: 0
        });

        _storeGameBet(betId, specificChoice);

        PlayerInfo storage pi = playerInfo[player];
        pi.totalBets++;
        pi.totalInValue += amount;
        pi.lastBetIds[pi.lastBetIdx] = betId;
        unchecked {
            pi.lastBetIdx = pi.lastBetIdx == 19 ? 0 : pi.lastBetIdx + 1;
        }

        totalBetsGlobal++;
        totalValueGlobal += amount;

        emit BetPlaced(betId, player, token, amount, betCount, gameChoice);
    }

    // ──────────────────── Play + Settle atomic (delegated mode, 1 tx) ────────────────────

    function playAndSettle(
        PlayParams calldata params
    ) external virtual override onlyCaller whenLive returns (uint256 betId, uint256 payout) {
        (betId, payout) = _executePlayAndSettle(params);
    }

    function previewPlay(
        bytes calldata gameChoice,
        address token,
        uint256 amount,
        uint256 seed
    ) external view virtual override returns (uint256 payout, uint256[] memory outcomes) {
        TokenConfig storage tc = supportedTokenInfo[token];
        if (tc.maxBetAmount == 0) revert TokenNotConfigured();

        (uint16 betCount, bytes memory specificChoice) = _decodeBaseChoice(gameChoice);
        if (betCount == 0) revert InvalidBetCount();

        uint256 betAmountPerRoll = amount / uint256(betCount);
        if (betAmountPerRoll < tc.minBetAmount || betAmountPerRoll > tc.maxBetAmount)
            revert BetAmountOutOfRange();

        _validateGameChoice(specificChoice);

        uint256 baseRandom = uint256(keccak256(abi.encode(seed)));
        if (_checkExplosion(baseRandom)) {
            outcomes = _previewExplosionOutcomes(specificChoice, betCount);
            return (0, outcomes);
        }

        outcomes = new uint256[](betCount);
        for (uint16 i = 0; i < betCount;) {
            uint256 rollRandom = uint256(keccak256(abi.encode(baseRandom, i)));
            uint256 rollPayout;
            (rollPayout, outcomes[i]) = _previewRoll(specificChoice, betAmountPerRoll, rollRandom);
            payout += rollPayout;
            unchecked { ++i; }
        }
    }

    function _executePlayAndSettle(PlayParams calldata params) internal returns (uint256 betId, uint256 payout) {
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

        payout = _resolveAtomically(betId, betCount, betAmountPerRoll, params.seed);
        baseBets[betId].payout = payout;

        _updatePlayerAfterSettle(params.player, params.amount, payout);

        if (payout > 0) {
            treasury.withdrawTokens(params.token, payout, params.player);
        }

        totalBetsGlobal++;
        totalValueGlobal += params.amount;
    }

    /// @dev Internal: resolve rolls atomically and emit event.
    function _resolveAtomically(
        uint256 betId,
        uint16 betCount,
        uint256 betAmountPerRoll,
        uint256 seed
    ) internal returns (uint256 payout) {
        uint256 baseRandom = uint256(keccak256(abi.encode(
            seed, block.timestamp, block.prevrandao, blockhash(block.number - 1)
        )));

        uint256[] memory outcomes;

        if (_checkExplosion(baseRandom)) {
            outcomes = _getExplosionOutcomes(betId);
            payout = 0;
        } else {
            outcomes = new uint256[](betCount);
            for (uint16 i = 0; i < betCount;) {
                uint256 rollRandom = uint256(keccak256(abi.encode(baseRandom, i)));
                payout += _roll(betId, betAmountPerRoll, rollRandom);
                outcomes[i] = _getRollOutcome(betId, rollRandom);
                unchecked { ++i; }
            }
        }

        BaseBet storage bet = baseBets[betId];
        emit BetSettled(betId, bet.player, bet.token, betAmountPerRoll * betCount, payout, outcomes);
        _emitLivePayout(betId, payout);
    }

    /// @dev Internal: update player stats after settlement.
    function _updatePlayerAfterSettle(address player, uint256 amount, uint256 payout) internal {
        PlayerInfo storage pi = playerInfo[player];
        pi.totalBets++;
        pi.totalInValue += amount;
        pi.lastBetIds[pi.lastBetIdx] = nextBetId - 1;
        unchecked {
            pi.lastBetIdx = pi.lastBetIdx == 19 ? 0 : pi.lastBetIdx + 1;
        }
        if (payout > 0) {
            pi.totalWins++;
            pi.totalOutValue += payout;
        }
    }

    // ──────────────────── Settle (called by backend) ────────────────────

    function settleBet(uint256 betId, uint256 seed) external virtual onlyCaller {
        BaseBet storage bet = baseBets[betId];
        if (bet.amount == 0 || bet.resolved) revert BetNotPending();

        uint256 baseRandom = _generateRandom(seed, bet.player, bet.placeBlockNumber);

        if (_checkExplosion(baseRandom)) {
            bet.resolved = true;
            bet.payout = 0;
            pendingBetId[bet.player] = 0;

            uint256[] memory explosionResults = _getExplosionOutcomes(betId);
            emit BetSettled(betId, bet.player, bet.token, bet.amount * bet.betCount, 0, explosionResults);
            _emitLivePayout(betId, 0);
            return;
        }

        uint256 totalPayout;
        uint256 totalBetAmount;
        uint256[] memory outcomes = new uint256[](bet.betCount);

        for (uint16 i = 0; i < bet.betCount;) {
            uint256 rollRandom = uint256(keccak256(abi.encode(baseRandom, i)));
            uint256 rollPayout = _roll(betId, bet.amount, rollRandom);
            outcomes[i] = _getRollOutcome(betId, rollRandom);
            totalPayout += rollPayout;
            totalBetAmount += bet.amount;
            unchecked { ++i; }
        }

        bet.resolved = true;
        bet.payout = totalPayout;
        pendingBetId[bet.player] = 0;

        if (totalPayout > 0) {
            PlayerInfo storage pi = playerInfo[bet.player];
            pi.totalWins++;
            pi.totalOutValue += totalPayout;
            treasury.withdrawTokens(bet.token, totalPayout, bet.player);
        }

        emit BetSettled(betId, bet.player, bet.token, totalBetAmount, totalPayout, outcomes);
        _emitLivePayout(betId, totalPayout);
    }

    // ──────────────────── Refund ────────────────────

    function refundBet(uint256 betId) external {
        BaseBet storage bet = baseBets[betId];
        if (bet.amount == 0) revert BetDoesNotExist();
        if (bet.resolved) revert BetNotPending();
        
        // Anyone can refund a bet if it's older than 256 blocks (EVM blockhash limit)
        if (block.number <= bet.placeBlockNumber + 256) revert RefundTooEarly();

        uint256 refundAmount = _getRefundAmount(betId);

        bet.resolved = true;
        bet.payout = refundAmount;
        pendingBetId[bet.player] = 0;

        if (bet.isCreditBet) {
            gameCredits.giftCredits(bet.player, refundAmount);
        } else {
            treasury.withdrawTokens(bet.token, refundAmount, bet.player);
        }

        emit BetRefunded(betId, bet.player, refundAmount, bet.token);
        _emitLivePayout(betId, refundAmount);
    }

    // ──────────────────── Internal: Random ────────────────────

    function _generateRandom(uint256 seed, address player, uint256 placeBlockNumber) internal view returns (uint256) {
        // We MUST use a blockhash from the past, but not older than 256 blocks.
        // If it's older than 256 blocks, blockhash returns 0, which is insecure.
        // The refundBet function handles the case where the bet is too old.
        require(block.number <= placeBlockNumber + 256, "Blockhash expired, use refundBet");
        
        uint256 pSeed = playerSeeds[player];
        if (pSeed == 0) {
            pSeed = uint256(uint160(player)); // Default to player address if no seed is set
        }

        return uint256(keccak256(abi.encode(
            seed,
            pSeed, // Incorporate the user's on-chain seed safely
            block.timestamp,
            block.prevrandao,
            blockhash(placeBlockNumber) // Use the block where the bet was placed
        )));
    }

    function _checkExplosion(uint256 randomNumber) internal view returns (bool) {
        return (randomNumber % 100) <= explosionRate;
    }

    // ──────────────────── View helpers ────────────────────

    function getPlayerInfo(address player) external view returns (PlayerInfo memory) {
        return playerInfo[player];
    }

    function lastBets(address player) external view returns (uint256[20] memory ids, uint8 idx) {
        PlayerInfo storage p = playerInfo[player];
        return (p.lastBetIds, p.lastBetIdx);
    }

    function _emitLivePayout(uint256 betId, uint256 payout) internal {
        BaseBet storage bet = baseBets[betId];
        emit LivePayout(
            bet.player,
            address(this),
            bet.token,
            _gameIdentifier(betId),
            payout
        );
    }

    // ──────────────────── Virtual (game-specific) ────────────────────

    function _gameIdentifier(uint256 /*betId*/) internal view virtual returns (uint256) {
        return NO_GAME_IDENTIFIER;
    }

    /// @dev Decode betCount + game-specific choice from gameChoice bytes.
    function _decodeBaseChoice(bytes calldata gameChoice)
        internal pure virtual
        returns (uint16 betCount, bytes memory specificChoice);

    /// @dev Validate the game-specific portion of the choice (revert if invalid).
    function _validateGameChoice(bytes memory specificChoice) internal view virtual;

    /// @dev Store game-specific bet data (choice, config, etc.).
    function _storeGameBet(uint256 betId, bytes memory specificChoice) internal virtual;

    /// @dev Execute a single roll and return the payout for that roll.
    function _roll(uint256 betId, uint256 betAmount, uint256 randomWord)
        internal view virtual returns (uint256 payout);

    /// @dev Return a numeric representation of the roll outcome (for events).
    function _getRollOutcome(uint256 betId, uint256 randomWord)
        internal view virtual returns (uint256 outcome);

    /// @dev Return outcomes array for explosion case.
    function _getExplosionOutcomes(uint256 betId)
        internal view virtual returns (uint256[] memory outcomes);

    /// @dev Preview a single roll using game-specific choice data (no state writes).
    function _previewRoll(bytes memory specificChoice, uint256 betAmount, uint256 randomWord)
        internal view virtual returns (uint256 payout, uint256 outcome);

    /// @dev Preview outcomes array for explosion case (no state writes).
    function _previewExplosionOutcomes(bytes memory specificChoice, uint16 betCount)
        internal view virtual returns (uint256[] memory outcomes);

    /// @dev Return the refund amount for a bet (default: full amount * betCount).
    function _getRefundAmount(uint256 betId) internal view virtual returns (uint256) {
        BaseBet storage bet = baseBets[betId];
        return bet.amount * bet.betCount;
    }
}
