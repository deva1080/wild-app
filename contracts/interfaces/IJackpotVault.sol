// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Interface for the monolithic JackpotVault.
///         - GameRouter calls contribute() on every bet to grow the pool.
///         - Authorized jackpot games call triggerPayout() when a player wins.
interface IJackpotVault {
    // ──────────────────── Events ────────────────────

    event JackpotContributed(address indexed token, uint256 amount, uint256 newBalance);
    event JackpotPaid(address indexed token, address indexed winner, uint256 prize, uint256 remaining);
    event ContributorSet(address indexed contributor, bool allowed);
    event GameSet(address indexed game, bool allowed);
    event MinBalanceSet(address indexed token, uint256 minBalance);

    // ──────────────────── Errors ────────────────────

    error NotAuthorizedContributor();
    error NotAuthorizedGame();
    error ExceedsMaxPayout();
    error JackpotInactive();
    error ZeroAmount();

    // ──────────────────── Views ────────────────────

    function jackpotBalance(address token) external view returns (uint256);
    function minJackpotBalance(address token) external view returns (uint256);
    function contributionBps() external view returns (uint256);
    function maxPayoutRatioBps() external view returns (uint256);

    /// @notice Returns the maximum prize claimable right now for `token`.
    ///         = jackpotBalance[token] * maxPayoutRatioBps / 10_000
    function maxPayout(address token) external view returns (uint256);

    /// @notice Returns true if the jackpot pool for `token` meets the minimum activation threshold.
    function isActive(address token) external view returns (bool);

    // ──────────────────── Contributor actions ────────────────────

    /// @notice Called by GameRouter on every bet. Virtually accrues a portion of
    ///         `betAmount` to the jackpot pool. No token transfer — funds live in Treasury.
    function contribute(address token, uint256 betAmount) external;

    // ──────────────────── Game actions ────────────────────

    /// @notice Called by an authorized jackpot game when a player wins.
    ///         Pays `amount` from the pool (capped at maxPayout).
    ///         Reverts if pool is below minJackpotBalance.
    /// @param token   Token to pay out.
    /// @param winner  Recipient of the prize.
    /// @param amount  Requested prize. Must be ≤ maxPayout(token).
    function triggerPayout(address token, address winner, uint256 amount) external;

    // ──────────────────── Admin ────────────────────

    function setContributor(address contributor, bool allowed) external;
    function setAuthorizedGame(address game, bool allowed) external;
    function setMinJackpotBalance(address token, uint256 minBalance) external;
    function setContributionBps(uint256 bps) external;
    function setMaxPayoutRatioBps(uint256 bps) external;
    function setTreasury(address treasury) external;
}
