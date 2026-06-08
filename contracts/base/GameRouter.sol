// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITreasury} from "../interfaces/ITreasury.sol";
import {IBaseGame} from "./IBaseGame.sol";
import {GameCredits} from "./GameCredits.sol";
import {IReferalLogic} from "../interfaces/IReferalLogic.sol";
import {IJackpotVault} from "../interfaces/IJackpotVault.sol";

contract GameRouter is Ownable {

    // ──────────────────── State ────────────────────

    ITreasury public treasury;
    GameCredits public gameCredits;
    IReferalLogic public referalLogic;
    IJackpotVault public jackpotVault;

    address public wildToken;

    mapping(address => bool) public registeredGames;
    mapping(address => bool) public callers;
    mapping(address => bool) public acceptedTokens;

    /// @notice Number of delegated plays the backend is authorized to execute for each player.
    mapping(address => uint256) public authorizedPlays;

    // ──────────────────── Errors ────────────────────

    error GameNotRegistered();
    error ZeroAmount();
    error NotAuthorizedCaller();
    error TokenNotAccepted();
    error NoAuthorizedPlays();

    // ──────────────────── Events ────────────────────

    event GamePlayed(
        address indexed game,
        address indexed player,
        address token,
        uint256 amount,
        uint256 betId
    );

    event GamePlayedWithCredits(
        address indexed game,
        address indexed player,
        uint256 creditAmount,
        uint256 betId
    );

    event GamePlayedDelegated(
        bytes32 indexed playCode,
        address indexed game,
        address indexed player,
        address token,
        uint256 amount,
        uint256 betId,
        uint256 payout
    );

    event TokenAccepted(address indexed token, bool status);
    event PlaysAuthorized(address indexed player, uint256 plays);
    event PlaysRevoked(address indexed player);

    // ──────────────────── Modifiers ────────────────────

    modifier onlyCaller() {
        if (!callers[msg.sender]) revert NotAuthorizedCaller();
        _;
    }

    // ──────────────────── Constructor ────────────────────

    constructor(
        address _treasury,
        address _gameCredits,
        address _wildToken
    ) Ownable(msg.sender) {
        treasury = ITreasury(_treasury);
        gameCredits = GameCredits(_gameCredits);
        wildToken = _wildToken;
    }

    // ──────────────────── Admin ────────────────────

    function setGame(address game, bool allowed) external onlyOwner {
        registeredGames[game] = allowed;
    }

    function setCaller(address _caller, bool _allowed) external onlyOwner {
        callers[_caller] = _allowed;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = ITreasury(_treasury);
    }

    function setGameCredits(address _gameCredits) external onlyOwner {
        gameCredits = GameCredits(_gameCredits);
    }

    function setWildToken(address _wildToken) external onlyOwner {
        wildToken = _wildToken;
    }

    /// @notice Set the active referral logic contract.
    ///         Pass address(0) to disable referrals without affecting any state.
    function setReferalLogic(address _referalLogic) external onlyOwner {
        referalLogic = IReferalLogic(_referalLogic);
    }

    /// @notice Set the jackpot vault. Pass address(0) to disable jackpot contributions.
    function setJackpotVault(address _jackpotVault) external onlyOwner {
        jackpotVault = IJackpotVault(_jackpotVault);
    }

    /// @notice Add or remove an accepted token for betting.
    /// When adding, the GameRouter pre-approves Treasury for unlimited spending of that token.
    function setAcceptedToken(address token, bool status) external onlyOwner {
        acceptedTokens[token] = status;
        if (status) {
            IERC20(token).approve(address(treasury), type(uint256).max);
        } else {
            IERC20(token).approve(address(treasury), 0);
        }
        emit TokenAccepted(token, status);
    }

    // ──────────────────── Player: Authorize / Revoke delegated plays ────────────────────

    /// @notice Set the number of plays the backend is allowed to execute on your behalf.
    /// Replaces any existing authorization. Call with 0 to stop delegated play immediately.
    function authorizePlays(uint256 plays) external {
        authorizedPlays[msg.sender] = plays;
        emit PlaysAuthorized(msg.sender, plays);
    }

    /// @notice Revoke all remaining delegated play authorization.
    function revokePlays() external {
        authorizedPlays[msg.sender] = 0;
        emit PlaysRevoked(msg.sender);
    }

    // ──────────────────── Play with wallet (classic approve, 2-tx) ────────────────────

    /// @notice User pre-approves GameRouter for `amount` of `token`, then calls this.
    /// Flow: user.approve(router, amount) → playGame(...) → router pulls tokens → deposits to treasury → game records bet.
    /// @param referrer Address that referred the player. Pass address(0) if none.
    ///                 Only used on the player's very first bet to register the referral.
    function playGame(
        address game,
        bytes calldata gameChoice,
        address token,
        uint256 amount,
        address referrer
    ) external {
        if (!registeredGames[game]) revert GameNotRegistered();
        if (!acceptedTokens[token]) revert TokenNotAccepted();
        if (amount == 0) revert ZeroAmount();

        IERC20(token).transferFrom(msg.sender, address(this), amount);
        treasury.depositTokens(token, amount);

        uint256 betId = IBaseGame(game).playFromRouter(
            msg.sender,
            gameChoice,
            token,
            amount
        );

        _notifyReferral(msg.sender, token, amount, referrer);
        _notifyJackpot(token, amount);

        emit GamePlayed(game, msg.sender, token, amount, betId);
    }

    // ──────────────────── Play with credits (2-tx) ────────────────────

    /// @param referrer Address that referred the player. Pass address(0) if none.
    function playGameWithCredits(
        address game,
        bytes calldata gameChoice,
        uint256 creditAmount,
        address referrer
    ) external {
        if (!registeredGames[game]) revert GameNotRegistered();
        if (creditAmount == 0) revert ZeroAmount();

        gameCredits.spendCredits(msg.sender, creditAmount);

        uint256 betId = IBaseGame(game).playFromRouterWithCredits(
            msg.sender,
            gameChoice,
            wildToken,
            creditAmount
        );

        _notifyReferral(msg.sender, wildToken, creditAmount, referrer);
        _notifyJackpot(wildToken, creditAmount);

        emit GamePlayedWithCredits(game, msg.sender, creditAmount, betId);
    }

    /// @notice Instant preview/demo for frontend UX. Does not move funds or write state.
    function previewGame(
        address game,
        bytes calldata gameChoice,
        address token,
        uint256 amount,
        uint256 seed,
        bool useCredits
    ) external view returns (uint256 payout, uint256[] memory outcomes) {
        if (!registeredGames[game]) revert GameNotRegistered();
        if (amount == 0) revert ZeroAmount();
        if (!useCredits && !acceptedTokens[token]) revert TokenNotAccepted();

        address betToken = useCredits ? wildToken : token;
        return IBaseGame(game).previewPlay(gameChoice, betToken, amount, seed);
    }

    // ──────────────────── Delegated play (1-tx, backend executes) ────────────────────

    /// @notice Backend calls this to atomically place + settle a bet on behalf of a player.
    /// The player must have pre-approved this contract for the token (or have enough credits).
    /// @param referrer Address that referred the player. Pass address(0) if none.
    function playGameDelegated(
        address game,
        address player,
        address token,
        uint256 amount,
        bytes calldata gameChoice,
        uint256 seed,
        bool useCredits,
        bytes32 playCode,
        address referrer
    ) external onlyCaller {
        if (!registeredGames[game]) revert GameNotRegistered();
        if (amount == 0) revert ZeroAmount();
        if (authorizedPlays[player] == 0) revert NoAuthorizedPlays();
        authorizedPlays[player]--;

        if (!useCredits) {
            if (!acceptedTokens[token]) revert TokenNotAccepted();
            IERC20(token).transferFrom(player, address(this), amount);
            treasury.depositTokens(token, amount);
        } else {
            gameCredits.spendCredits(player, amount);
        }

        address betToken = useCredits ? wildToken : token;

        (uint256 betId, uint256 payout) = IBaseGame(game).playAndSettle(
            IBaseGame.PlayParams({
                player: player,
                gameChoice: gameChoice,
                token: betToken,
                amount: amount,
                isCreditBet: useCredits,
                seed: seed
            })
        );

        _notifyReferral(player, betToken, amount, referrer);
        _notifyJackpot(betToken, amount);

        emit GamePlayedDelegated(playCode, game, player, betToken, amount, betId, payout);
    }

    // ──────────────────── Internal helpers ────────────────────

    /// @dev Fire-and-forget referral notification. Wrapped in try/catch so a bug
    ///      in the logic contract can never block a bet from completing.
    function _notifyReferral(address player, address token, uint256 amount, address referrer) internal {
        IReferalLogic logic = referalLogic;
        if (address(logic) == address(0)) return;
        try logic.onBet(player, token, amount, referrer) {} catch {}
    }

    /// @dev Fire-and-forget jackpot contribution. Same try/catch pattern — a vault
    ///      bug can never revert a player's bet.
    function _notifyJackpot(address token, uint256 amount) internal {
        IJackpotVault vault = jackpotVault;
        if (address(vault) == address(0)) return;
        try vault.contribute(token, amount) {} catch {}
    }
}
