// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

interface IBaseGame {
    struct PlayParams {
        address player;
        bytes gameChoice;
        address token;
        uint256 amount;
        bool isCreditBet;
        uint256 seed;
    }

    function playFromRouter(
        address player,
        bytes calldata gameChoice,
        address token,
        uint256 amount
    ) external returns (uint256 betId);

    function playFromRouterWithCredits(
        address player,
        bytes calldata gameChoice,
        address token,
        uint256 amount
    ) external returns (uint256 betId);

    /// @notice Atomic play + settle in a single tx. No pending state.
    function playAndSettle(PlayParams calldata params) external returns (uint256 betId, uint256 payout);
}
