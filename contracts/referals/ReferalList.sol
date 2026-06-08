// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {GameCredits} from "../base/GameCredits.sol";
import {IReferalRegistry} from "../interfaces/IReferalRegistry.sol";

/// @title  ReferalRegistry
/// @notice Permanent data store for the referral system.
///         Stores who referred whom and accumulates pending rewards.
///         Business logic (level tiers, milestones, weekly goals) lives in a
///         separate ReferalLogic contract that can be swapped without migrating data.
///
/// Upgrade path:
///   1. Deploy new ReferalLogicVX
///   2. owner.setWriter(newLogic, true) + setWriter(oldLogic, false)
///   3. GameRouter.setReferalLogic(newLogic)
///   → All referral relationships and pending rewards stay intact here.
contract ReferalRegistry is Ownable, IReferalRegistry {

    // ──────────────────── State ────────────────────

    /// @notice Used to convert pending token rewards to credits at claim time.
    ///         Conversion: credits = pendingRewards[token] * gameCredits.tokenRatio(token) / 1e18
    GameCredits public gameCredits;

    /// @notice Who referred each player. Written once on first bet, never changed.
    mapping(address => address) public referrerOf;

    /// @notice True once a player has placed their first bet (or self-registered).
    ///         Distinguishes "new player" from "player with no referrer".
    mapping(address => bool) public referralLocked;

    /// @notice Accrued rewards per referrer per token, ready to claim.
    mapping(address => mapping(address => uint256)) public pendingRewards;

    /// @notice Contracts allowed to call writer functions (i.e. active ReferalLogic).
    mapping(address => bool) public authorizedWriters;

    // ──────────────────── Constructor ────────────────────

    constructor(address _gameCredits) Ownable(msg.sender) {
        gameCredits = GameCredits(_gameCredits);
    }

    // ──────────────────── Modifiers ────────────────────

    modifier onlyWriter() {
        if (!authorizedWriters[msg.sender]) revert NotAuthorizedWriter();
        _;
    }

    // ──────────────────── Player actions ────────────────────

    /// @notice Manually register a referrer BEFORE placing any bet.
    ///         Once locked (by this call or by the first bet), the referrer cannot change.
    function registerReferral(address referrer) external {
        if (referralLocked[msg.sender]) revert AlreadyRegistered();
        if (referrer == address(0))     revert InvalidReferrer();
        if (referrer == msg.sender)     revert CannotReferSelf();

        referralLocked[msg.sender] = true;
        referrerOf[msg.sender]     = referrer;
        emit ReferralRegistered(msg.sender, referrer);
    }

    /// @notice Claim all pending rewards for `token`, converted to GameCredits.
    ///         Conversion uses GameCredits.tokenRatio(token) — the same rate players
    ///         use when purchasing credits manually.
    ///         Reverts if the token has no ratio configured in GameCredits.
    function claimRewards(address token) external {
        uint256 amount = pendingRewards[msg.sender][token];
        if (amount == 0) revert NothingToClaim();

        uint256 ratio = gameCredits.tokenRatio(token);
        if (ratio == 0) revert TokenRatioNotSet();

        pendingRewards[msg.sender][token] = 0;

        uint256 credits = amount * ratio / 1e18;
        gameCredits.giftCredits(msg.sender, credits);

        emit RewardClaimed(msg.sender, token, amount);
    }

    // ──────────────────── Writer actions ────────────────────

    /// @notice Called by ReferalLogic on every player's first bet.
    ///         Locks the referral slot and registers `referrer` if non-zero.
    ///         No-op if slot is already locked (idempotent).
    function lockAndRegister(address player, address referrer) external onlyWriter {
        if (referralLocked[player]) return;

        referralLocked[player] = true;

        if (referrer != address(0) && referrer != player) {
            referrerOf[player] = referrer;
            emit ReferralRegistered(player, referrer);
        }
    }

    /// @notice Accrue a reward for `referrer`. Only callable by authorized writers.
    function accrueReward(address referrer, address token, uint256 amount) external onlyWriter {
        if (referrer == address(0) || amount == 0) return;
        pendingRewards[referrer][token] += amount;
        emit RewardAccrued(referrer, token, amount);
    }

    // ──────────────────── Admin ────────────────────

    /// @notice Grant or revoke write access to a ReferalLogic contract.
    function setWriter(address writer, bool allowed) external onlyOwner {
        authorizedWriters[writer] = allowed;
        emit WriterSet(writer, allowed);
    }

    function setGameCredits(address _gameCredits) external onlyOwner {
        gameCredits = GameCredits(_gameCredits);
    }
}
