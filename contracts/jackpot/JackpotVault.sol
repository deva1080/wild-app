// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {ITreasury} from "../interfaces/ITreasury.sol";
import {IJackpotVault} from "../interfaces/IJackpotVault.sol";

/// @title  JackpotVault
/// @notice Monolithic jackpot pool shared across all jackpot games.
///         Holds a virtual balance per token (actual tokens live in Treasury).
///         Any number of jackpot games can be authorized to trigger payouts —
///         add new game types without redeploying this contract.
///
/// Architecture:
///   - GameRouter calls contribute() on every bet → pool grows from house edge.
///   - Jackpot games call triggerPayout() when a player wins.
///   - Prize = min(requestedAmount, maxPayout(token)).
///   - A portion of the pool always stays as seed for the next round (maxPayoutRatioBps).
///   - The jackpot is inactive per-token until pool ≥ minJackpotBalance[token].
///
/// Adding a new jackpot game:
///   1. Deploy the game contract.
///   2. vault.setAuthorizedGame(newGame, true)   ← single tx, no redeploy.
contract JackpotVault is Ownable, IJackpotVault {

    // ──────────────────── Constants ────────────────────

    uint256 public constant BPS_DENOMINATOR  = 10_000;
    uint256 public constant MAX_CONTRIBUTION_BPS = 200;  // hard cap: max 2% contribution
    uint256 public constant MAX_PAYOUT_RATIO_BPS = 9_000; // hard cap: max 90% of pool per payout

    // ──────────────────── State ────────────────────

    ITreasury public treasury;

    /// @notice Virtual jackpot balance per token. Actual tokens are held in Treasury.
    mapping(address => uint256) public jackpotBalance;

    /// @notice Minimum pool balance required for the jackpot to be active per token.
    ///         Games should call isActive() before triggering a payout.
    mapping(address => uint256) public minJackpotBalance;

    /// @notice Contracts allowed to call contribute() — GameRouter and future routers.
    mapping(address => bool) public authorizedContributors;

    /// @notice Contracts allowed to call triggerPayout() — jackpot games.
    mapping(address => bool) public authorizedGames;

    /// @notice Basis points of each bet added to the jackpot pool. e.g. 15 = 0.15%.
    uint256 public contributionBps;

    /// @notice Maximum fraction of the pool that can be paid out in a single trigger.
    ///         e.g. 8000 = 80% → 20% always stays as seed. Default: 80%.
    uint256 public maxPayoutRatioBps;

    // ──────────────────── Constructor ────────────────────

    constructor(
        address _treasury,
        uint256 _contributionBps,
        uint256 _maxPayoutRatioBps
    ) Ownable(msg.sender) {
        require(_contributionBps    <= MAX_CONTRIBUTION_BPS,  "contribution too high");
        require(_maxPayoutRatioBps  <= MAX_PAYOUT_RATIO_BPS,  "payout ratio too high");
        require(_maxPayoutRatioBps  > 0,                      "payout ratio zero");
        treasury          = ITreasury(_treasury);
        contributionBps   = _contributionBps;
        maxPayoutRatioBps = _maxPayoutRatioBps;
    }

    // ──────────────────── Modifiers ────────────────────

    modifier onlyContributor() {
        if (!authorizedContributors[msg.sender]) revert NotAuthorizedContributor();
        _;
    }

    modifier onlyGame() {
        if (!authorizedGames[msg.sender]) revert NotAuthorizedGame();
        _;
    }

    // ──────────────────── Views ────────────────────

    /// @notice Maximum prize claimable right now for `token`.
    function maxPayout(address token) public view returns (uint256) {
        return (jackpotBalance[token] * maxPayoutRatioBps) / BPS_DENOMINATOR;
    }

    /// @notice True if the pool for `token` meets its minimum activation threshold.
    function isActive(address token) public view returns (bool) {
        return jackpotBalance[token] >= minJackpotBalance[token] &&
               minJackpotBalance[token] > 0;
    }

    // ──────────────────── Contributor actions ────────────────────

    /// @notice Called by GameRouter on every bet. No token transfer — purely virtual accounting.
    ///         If contributionBps is 0 the call is a no-op.
    function contribute(address token, uint256 betAmount) external onlyContributor {
        if (contributionBps == 0 || betAmount == 0) return;
        uint256 contribution = (betAmount * contributionBps) / BPS_DENOMINATOR;
        jackpotBalance[token] += contribution;
        emit JackpotContributed(token, contribution, jackpotBalance[token]);
    }

    // ──────────────────── Game actions ────────────────────

    /// @notice Authorized jackpot games call this when a player wins.
    ///         The game is responsible for calculating the prize (bet * multiplier)
    ///         and passing min(prize, maxPayout(token)) as `amount`.
    ///         Reverts if the pool is not yet active or amount exceeds the cap.
    function triggerPayout(address token, address winner, uint256 amount) external onlyGame {
        if (amount == 0) revert ZeroAmount();
        if (!isActive(token)) revert JackpotInactive();

        uint256 cap = maxPayout(token);
        if (amount > cap) revert ExceedsMaxPayout();

        jackpotBalance[token] -= amount;
        treasury.withdrawTokens(token, amount, winner);

        emit JackpotPaid(token, winner, amount, jackpotBalance[token]);
    }

    // ──────────────────── Admin ────────────────────

    function setContributor(address contributor, bool allowed) external onlyOwner {
        authorizedContributors[contributor] = allowed;
        emit ContributorSet(contributor, allowed);
    }

    function setAuthorizedGame(address game, bool allowed) external onlyOwner {
        authorizedGames[game] = allowed;
        emit GameSet(game, allowed);
    }

    /// @notice Set the minimum pool threshold for `token` to activate the jackpot.
    ///         Set to 0 to disable the minimum check (always active).
    function setMinJackpotBalance(address token, uint256 minBalance) external onlyOwner {
        minJackpotBalance[token] = minBalance;
        emit MinBalanceSet(token, minBalance);
    }

    function setContributionBps(uint256 bps) external onlyOwner {
        require(bps <= MAX_CONTRIBUTION_BPS, "contribution too high");
        contributionBps = bps;
    }

    function setMaxPayoutRatioBps(uint256 bps) external onlyOwner {
        require(bps > 0 && bps <= MAX_PAYOUT_RATIO_BPS, "invalid payout ratio");
        maxPayoutRatioBps = bps;
    }

    function setTreasury(address _treasury) external onlyOwner {
        treasury = ITreasury(_treasury);
    }
}
