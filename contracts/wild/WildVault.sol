// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {IWildVault} from "../interfaces/IWildVault.sol";

/// @title  WildVault
/// @notice Fixed-price swap vault for WILD tokens.
///         Users buy WILD by paying a supported token (e.g. USDC) at a configured rate.
///         Users sell WILD back for a supported token at a (potentially different) rate.
///         The spread between buy and sell rates is the vault's implicit margin.
///
/// Rate encoding (WILD wei per payment-token wei):
///   USDC has 6 dec, WILD has 18 dec.
///   1 USDC → 10 WILD  ⟹  buyRate[USDC]  = 10 * 1e18 / 1e6 = 10e12
///   With spread      ⟹  sellRate[USDC] = 11 * 1e18 / 1e6 = 11e12
///   No spread        ⟹  sellRate[USDC] = buyRate[USDC]
///
/// Liquidity:
///   - WILD reserve: funded by owner via depositWild().
///   - Token reserve: filled automatically by user purchases.
///   - Both sides revert if insufficient liquidity.
contract WildVault is Ownable, ReentrancyGuard, IWildVault {

    // ──────────────────── State ────────────────────

    address public immutable wildToken;

    /// @notice WILD wei received per 1 payment-token wei (buying WILD).
    mapping(address => uint256) public buyRate;

    /// @notice WILD wei required per 1 payment-token wei (selling WILD).
    mapping(address => uint256) public sellRate;

    /// @notice Whether a token is currently active for swapping.
    mapping(address => bool) public acceptedTokens;

    // ──────────────────── Constructor ────────────────────

    constructor(address _wildToken) Ownable(msg.sender) {
        require(_wildToken != address(0), "zero address");
        wildToken = _wildToken;
    }

    // ──────────────────── Views ────────────────────

    /// @notice How much WILD you receive for `tokenAmount` of `token`.
    function previewBuy(address token, uint256 tokenAmount) public view returns (uint256 wildAmount) {
        if (!acceptedTokens[token]) revert TokenNotAccepted();
        uint256 rate = buyRate[token];
        if (rate == 0) revert RateNotSet();
        wildAmount = tokenAmount * rate;
    }

    /// @notice How much `token` you receive for `wildAmount` of WILD.
    ///         Result is floored (integer division).
    function previewSell(address token, uint256 wildAmount) public view returns (uint256 tokenAmount) {
        if (!acceptedTokens[token]) revert TokenNotAccepted();
        uint256 rate = sellRate[token];
        if (rate == 0) revert RateNotSet();
        tokenAmount = wildAmount / rate;
    }

    // ──────────────────── User actions ────────────────────

    /// @notice Buy WILD with `tokenAmount` of `token`.
    ///         Caller must approve this contract for `tokenAmount` before calling.
    function buyWild(address token, uint256 tokenAmount) external nonReentrant returns (uint256 wildAmount) {
        if (tokenAmount == 0) revert ZeroAmount();

        wildAmount = previewBuy(token, tokenAmount);

        uint256 wildBalance = IERC20(wildToken).balanceOf(address(this));
        if (wildBalance < wildAmount) revert InsufficientWildReserve(wildBalance, wildAmount);

        IERC20(token).transferFrom(msg.sender, address(this), tokenAmount);
        IERC20(wildToken).transfer(msg.sender, wildAmount);

        emit WildBought(msg.sender, token, tokenAmount, wildAmount);
    }

    /// @notice Sell `wildAmount` of WILD for `token`.
    ///         Caller must approve this contract for `wildAmount` before calling.
    ///         Received token amount is floored to avoid fractional token dust.
    function sellWild(address token, uint256 wildAmount) external nonReentrant returns (uint256 tokenAmount) {
        if (wildAmount == 0) revert ZeroAmount();

        tokenAmount = previewSell(token, wildAmount);
        if (tokenAmount == 0) revert ZeroAmount();

        uint256 tokenBalance = IERC20(token).balanceOf(address(this));
        if (tokenBalance < tokenAmount) revert InsufficientTokenReserve(tokenBalance, tokenAmount);

        IERC20(wildToken).transferFrom(msg.sender, address(this), wildAmount);
        IERC20(token).transfer(msg.sender, tokenAmount);

        emit WildSold(msg.sender, token, wildAmount, tokenAmount);
    }

    // ──────────────────── Admin ────────────────────

    /// @notice Configure rates for a payment token.
    ///         Pass sellRate == buyRate for zero spread.
    ///         Both values must be > 0.
    function setRate(address token, uint256 _buyRate, uint256 _sellRate) external onlyOwner {
        if (token == address(0))  revert InvalidRate();
        if (_buyRate == 0)        revert InvalidRate();
        if (_sellRate == 0)       revert InvalidRate();

        buyRate[token]      = _buyRate;
        sellRate[token]     = _sellRate;
        acceptedTokens[token] = true;

        emit RateSet(token, _buyRate, _sellRate);
    }

    /// @notice Disable a token. Rates are preserved in storage but the token
    ///         cannot be used until re-enabled via setRate().
    function removeToken(address token) external onlyOwner {
        acceptedTokens[token] = false;
        emit TokenRemoved(token);
    }

    /// @notice Fund the vault's WILD sell-side reserve.
    ///         Owner must approve this contract for `amount` before calling.
    function depositWild(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        IERC20(wildToken).transferFrom(msg.sender, address(this), amount);
        emit WildDeposited(msg.sender, amount);
    }

    /// @notice Withdraw WILD from the vault (e.g. to rebalance or wind down).
    function withdrawWild(uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        uint256 balance = IERC20(wildToken).balanceOf(address(this));
        if (balance < amount) revert InsufficientWildReserve(balance, amount);
        IERC20(wildToken).transfer(msg.sender, amount);
        emit WildWithdrawn(msg.sender, amount);
    }

    /// @notice Withdraw accumulated payment tokens (USDC, etc.) collected from buyers.
    function withdrawToken(address token, uint256 amount) external onlyOwner {
        if (amount == 0) revert ZeroAmount();
        uint256 balance = IERC20(token).balanceOf(address(this));
        if (balance < amount) revert InsufficientTokenReserve(balance, amount);
        IERC20(token).transfer(msg.sender, amount);
        emit TokenWithdrawn(token, amount, msg.sender);
    }
}
