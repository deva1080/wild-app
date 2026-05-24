// SPDX-License-Identifier: MIT
pragma solidity ^0.8.0;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

contract TreasuryTest is Ownable {
    // Estructura para llevar un registro de ingresos y egresos
    struct GameStats {
        uint256 totalDeposits; // Total de ingresos
        uint256 totalWithdrawals; // Total de egresos
    }

    // Variables globales para controlar ingresos y egresos totales
    uint256 public ownerDeposits;
    uint256 public ownerWithdrawals;
   
    address[] public acceptedTokensList;
    address[] public authorizedContractsList;

    mapping(address => uint) public totalGlobalDepositsPerToken;
    mapping(address => uint) public totalGlobalWithdrawalsPerToken;
    mapping(address => bool) public acceptedTokens;
    mapping(address => bool) public authorizedContracts;
    mapping(address contractAddress=>mapping(address token => GameStats)) public gameStats; 

   


    // Eventos
    event TokenAccepted(address indexed token, bool status);
    event ContractAuthorized(address indexed gameContract, bool status);
    event TokensDeposited(address indexed gameContract, address indexed token, uint256 amount);
    event TokensWithdrawn(address indexed gameContract, address indexed recipient, address indexed token, uint256 amount);

    // Modificador para contratos autorizados
    modifier onlyAuthorized() {
        require(authorizedContracts[msg.sender], "Not an authorized contract");
        _;
    }

    constructor () Ownable(msg.sender) {
        
    }

    
    // Agregar o remover contratos autorizados
    function setAuthorizedContract(address gameContract, bool status) external onlyOwner {
        authorizedContracts[gameContract] = status;
        if(status){
            authorizedContractsList.push(gameContract);
        }else{
            for(uint256 i = 0; i < authorizedContractsList.length; i++){
                if(authorizedContractsList[i] == gameContract){
                    authorizedContractsList[i] = address(0);
                }
            }
        }
        emit ContractAuthorized(gameContract, status);
    }

    // Agregar o remover tokens aceptados
    function setAcceptedToken(address token, bool status) external onlyOwner {
        acceptedTokens[token] = status;
        if(status){
            acceptedTokensList.push(token);
        }else{
            for(uint256 i = 0; i < acceptedTokensList.length; i++){
                if(acceptedTokensList[i] == token){
                    acceptedTokensList[i] = address(0);
                }
            }       
        }
        emit TokenAccepted(token, status);
    }

    function ownerDeposit(address token, uint256 amount) external onlyOwner {
        ownerDeposits += amount;
        IERC20(token).transferFrom(msg.sender, address(this), amount);
        totalGlobalDepositsPerToken[token] += amount;
    }

    function ownerWithdrawal(address token, uint256 amount) external onlyOwner {
        ownerWithdrawals += amount;
        IERC20(token).transfer(msg.sender, amount);
        totalGlobalWithdrawalsPerToken[token] += amount;
    }

    // Depósito de tokens por parte de un contrato de juego
    function depositTokens(address token, uint256 amount) external onlyAuthorized {
        require(acceptedTokens[token], "Token not accepted");
        require(amount > 0, "Amount must be greater than zero");
        require(amount <= IERC20(token).balanceOf(address(this)));

        IERC20(token).transferFrom(msg.sender, address(this), amount);

        // Actualizar estadísticas
        gameStats[msg.sender][token].totalDeposits += amount;
        totalGlobalDepositsPerToken[token] += amount;

        emit TokensDeposited(msg.sender, token, amount);
    }

    // Retiro de tokens hacia una wallet (llamado por contratos de juego)
    function withdrawTokens(address token, uint256 amount, address recipient) external onlyAuthorized {
        require(acceptedTokens[token], "Token not accepted");
        require(amount > 0, "Amount must be greater than zero");
        require(recipient != address(0), "Invalid recipient");
        require(amount <= IERC20(token).balanceOf(address(this)));

        IERC20(token).transfer(recipient, amount);

        // Actualizar estadísticas
        gameStats[msg.sender][token].totalWithdrawals += amount;
        totalGlobalWithdrawalsPerToken[token] += amount;

        emit TokensWithdrawn(msg.sender, recipient, token, amount);
    }

    // Función para que el owner retire tokens de emergencia
    function emergencyWithdraw(address token, uint256 amount, address recipient) external onlyOwner {
        
        require(amount > 0, "Amount must be greater than zero");
        require(recipient != address(0), "Invalid recipient");

        IERC20(token).transfer(recipient, amount);
    }
}
