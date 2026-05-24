// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

interface ITreasury {
    // Estructura para estadísticas por contrato de juego
    struct GameStats {
        uint256 totalDeposits;
        uint256 totalWithdrawals;
    }

    // Variables globales
    function totalGlobalDeposits() external view returns (uint256);
    function totalGlobalWithdrawals() external view returns (uint256);

    // Listas y mapeos
    function acceptedTokensList(uint256 index) external view returns (address);
    function authorizedContractsList(uint256 index) external view returns (address);
    function acceptedTokens(address token) external view returns (bool);
    function authorizedContracts(address gameContract) external view returns (bool);
    function gameStats(address gameContract) external view returns (GameStats memory);

    // Eventos
    event TokenAccepted(address indexed token, bool status);
    event ContractAuthorized(address indexed gameContract, bool status);
    event TokensDeposited(address indexed gameContract, address indexed token, uint256 amount);
    event TokensWithdrawn(address indexed gameContract, address indexed recipient, address indexed token, uint256 amount);

    // Funciones
    function setAuthorizedContract(address gameContract, bool status) external;
    function setAcceptedToken(address token, bool status) external;
    function depositTokens(address token, uint256 amount) external;
    function withdrawTokens(address token, uint256 amount, address recipient) external;
    function emergencyWithdraw(address token, uint256 amount, address recipient) external;
}