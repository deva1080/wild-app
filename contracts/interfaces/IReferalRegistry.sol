// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IReferalRegistry {
    // ──────────────────── Events ────────────────────

    event ReferralRegistered(address indexed player, address indexed referrer);
    event RewardAccrued(address indexed referrer, address indexed token, uint256 amount);
    event RewardClaimed(address indexed referrer, address indexed token, uint256 amount);
    event WriterSet(address indexed writer, bool allowed);

    // ──────────────────── Errors ────────────────────

    error AlreadyRegistered();
    error CannotReferSelf();
    error InvalidReferrer();
    error NotAuthorizedWriter();
    error NothingToClaim();
    error TokenRatioNotSet();

    // ──────────────────── Data views ────────────────────

    function referrerOf(address player) external view returns (address);
    function referralLocked(address player) external view returns (bool);
    function pendingRewards(address referrer, address token) external view returns (uint256);
    function authorizedWriters(address writer) external view returns (bool);

    // ──────────────────── Player actions ────────────────────

    /// @notice Manually register a referrer before your first bet.
    ///         Locks the slot — cannot be changed afterwards.
    function registerReferral(address referrer) external;

    /// @notice Withdraw all accumulated rewards for a given token.
    function claimRewards(address token) external;

    // ──────────────────── Writer actions (called by ReferalLogic) ────────────────────

    /// @notice On a player's first bet: lock their referral slot and optionally register
    ///         `referrer`. No-op if the slot is already locked.
    ///         Only callable by authorized writers.
    function lockAndRegister(address player, address referrer) external;

    /// @notice Accrue `amount` of `token` reward for `referrer`.
    ///         Only callable by authorized writers.
    function accrueReward(address referrer, address token, uint256 amount) external;

    // ──────────────────── Admin ────────────────────

    function setWriter(address writer, bool allowed) external;
    function setGameCredits(address gameCredits) external;
}
