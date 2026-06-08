// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal interface that GameRouter calls after every bet.
/// Deploy a new contract implementing this interface to upgrade referral logic
/// without touching the ReferalRegistry or any game contract.
interface IReferalLogic {
    /// @notice Notify the referral logic that `player` placed a bet.
    /// @param player     The bettor.
    /// @param token      ERC-20 token used for the bet.
    /// @param betAmount  Total amount wagered.
    /// @param referrer   Address that referred `player` (address(0) if none).
    ///                   Only used on the player's first bet to register the relationship.
    function onBet(address player, address token, uint256 betAmount, address referrer) external;
}
