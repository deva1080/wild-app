// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Interface for the WildVault fixed-price swap contract.
///
/// Rates are expressed as WILD wei per payment-token wei (smallest units).
///
/// Example — USDC has 6 decimals, WILD has 18:
///   1 USDC = 10 WILD  →  buyRate[USDC]  = 10e18 / 1e6  = 10_000_000_000_000  (10e12)
///   spread of 1 WILD  →  sellRate[USDC] = 11e18 / 1e6  = 11_000_000_000_000  (11e12)
///   (spread = 0)      →  sellRate[USDC] == buyRate[USDC]
interface IWildVault {
    // ──────────────────── Events ────────────────────

    event WildBought(
        address indexed buyer,
        address indexed token,
        uint256 tokenAmount,
        uint256 wildAmount
    );
    event WildSold(
        address indexed seller,
        address indexed token,
        uint256 wildAmount,
        uint256 tokenAmount
    );
    event RateSet(address indexed token, uint256 buyRate, uint256 sellRate);
    event TokenRemoved(address indexed token);
    event WildDeposited(address indexed from, uint256 amount);
    event WildWithdrawn(address indexed to, uint256 amount);
    event TokenWithdrawn(address indexed token, uint256 amount, address indexed to);

    // ──────────────────── Errors ────────────────────

    error TokenNotAccepted();
    error ZeroAmount();
    error RateNotSet();
    error InsufficientWildReserve(uint256 available, uint256 required);
    error InsufficientTokenReserve(uint256 available, uint256 required);
    error InvalidRate();

    // ──────────────────── Views ────────────────────

    function wildToken() external view returns (address);

    /// @notice WILD wei received per 1 payment-token wei when buying WILD.
    function buyRate(address token) external view returns (uint256);

    /// @notice WILD wei required per 1 payment-token wei when selling WILD back.
    function sellRate(address token) external view returns (uint256);

    function acceptedTokens(address token) external view returns (bool);

    /// @notice Preview: how much WILD you get for `tokenAmount` of `token`.
    function previewBuy(address token, uint256 tokenAmount) external view returns (uint256 wildAmount);

    /// @notice Preview: how much `token` you get for `wildAmount` of WILD.
    function previewSell(address token, uint256 wildAmount) external view returns (uint256 tokenAmount);

    // ──────────────────── User actions ────────────────────

    /// @notice Pay `tokenAmount` of `token`, receive WILD.
    ///         Caller must pre-approve this contract for `tokenAmount`.
    function buyWild(address token, uint256 tokenAmount) external returns (uint256 wildAmount);

    /// @notice Pay `wildAmount` of WILD, receive `token`.
    ///         Caller must pre-approve this contract for `wildAmount`.
    function sellWild(address token, uint256 wildAmount) external returns (uint256 tokenAmount);

    // ──────────────────── Admin ────────────────────

    /// @notice Set buy/sell rates for a token. Automatically marks it as accepted.
    ///         Both rates must be > 0. Set sellRate == buyRate for zero spread.
    function setRate(address token, uint256 _buyRate, uint256 _sellRate) external;

    /// @notice Remove a token from accepted list (rates remain stored but inactive).
    function removeToken(address token) external;

    /// @notice Owner deposits WILD into the vault to fund buy-side liquidity.
    function depositWild(uint256 amount) external;

    /// @notice Owner withdraws WILD from the vault.
    function withdrawWild(uint256 amount) external;

    /// @notice Owner withdraws any accumulated payment tokens from the vault.
    function withdrawToken(address token, uint256 amount) external;
}
