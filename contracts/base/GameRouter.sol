// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ITreasury} from "../interfaces/ITreasury.sol";
import {IBaseGame} from "./IBaseGame.sol";
import {GameCredits} from "./GameCredits.sol";

contract GameRouter is Ownable {

    // ──────────────────── State ────────────────────

    ITreasury public treasury;
    GameCredits public gameCredits;

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

    /// @notice Add or remove an accepted token for betting.
    /// When adding, the GameRouter pre-approves Treasury for unlimited spending of that token.
    function setAcceptedToken(address token, bool status) external onlyOwner {
        acceptedTokens[token] = status;
        if (status) {
            IERC20(token).approve(address(treasury), type(uint256).max);
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
    function playGame(
        address game,
        bytes calldata gameChoice,
        address token,
        uint256 amount
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

        emit GamePlayed(game, msg.sender, token, amount, betId);
    }

    // ──────────────────── Play with credits (2-tx) ────────────────────

    function playGameWithCredits(
        address game,
        bytes calldata gameChoice,
        uint256 creditAmount
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

        emit GamePlayedWithCredits(game, msg.sender, creditAmount, betId);
    }

    // ──────────────────── Delegated play (1-tx, backend executes) ────────────────────

    /// @notice Backend calls this to atomically place + settle a bet on behalf of a player.
    /// The player must have pre-approved this contract for the token (or have enough credits).
    function playGameDelegated(
        address game,
        address player,
        address token,
        uint256 amount,
        bytes calldata gameChoice,
        uint256 seed,
        bool useCredits
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

        emit GamePlayedDelegated(game, player, betToken, amount, betId, payout);
    }
}
