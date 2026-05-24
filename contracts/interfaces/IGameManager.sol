// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.28;

// Interface para Manager (Flip)
interface IFlipManager {
    function bets(uint256 betId) external view returns (
        bool choice,
        bool winResult,
        uint176 placeBlockNumber,
        uint128 amount,
        uint128 winAmount,
        address player,
        address token,
        bool isSettled
    );
    
    function betsLength() external view returns (uint256);
    function gameIsLive() external view returns (bool);
    function betMap(bytes32 key) external view returns (uint256[] memory);
    function getPlayerBets(address player) external view returns (uint256[] memory);
}

// Interface para ManagerCrash
interface ICrashManager {
    function bets(uint256 betId) external view returns (
        uint40 choice,
        uint40 outcome,
        uint176 placeBlockNumber,
        uint128 amount,
        uint128 winAmount,
        address player,
        address token,
        bool isSettled
    );
    
    function betsLength() external view returns (uint256);
    function gameIsLive() external view returns (bool);
    function betMap(bytes32 key) external view returns (uint256[] memory);
    function getPlayerBets(address player) external view returns (uint256[] memory);
}

// Interface para ManagerRPS
interface IRPSManager {
    function bets(uint256 betId) external view returns (
        uint8 choice,
        uint8 outcome,
        bool isDraw,
        uint176 placeBlockNumber,
        uint128 amount,
        uint128 winAmount,
        address player,
        address token,
        bool isSettled
    );
    
    function betsLength() external view returns (uint256);
    function gameIsLive() external view returns (bool);
    function betMap(bytes32 key) external view returns (uint256[] memory);
    function getPlayerBets(address player) external view returns (uint256[] memory);
}
