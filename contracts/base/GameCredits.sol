// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";

/// @title GameCredits - Non-withdrawable in-platform balance denominated in WILD units (18 decimals).
/// Users can purchase credits with whitelisted tokens at owner-defined ratios.
/// Credits can only be spent on games. Winnings are paid in WILD to the player's wallet.
contract GameCredits is Ownable {

    // ──────────────────── State ────────────────────

    /// @notice The platform token used to pay winnings from credit-based bets.
    IERC20 public wildToken;

    /// @notice Credit balance per user (18 decimals, denominated in WILD units).
    mapping(address => uint256) public balanceOf;

    /// @notice Conversion ratio per token: how many credits (18 dec) per 1 full token deposited.
    /// E.g. ratio = 2e18 means 1 token deposited = 2 credits.
    mapping(address => uint256) public tokenRatio;

    /// @notice Whether a token is allowed for purchasing credits.
    mapping(address => bool) public allowedToken;

    /// @notice Contracts authorized to spend user credits (GameRouter, games).
    mapping(address => bool) public authorizedSpenders;

    /// @notice Contracts authorized to gift credits (e.g. ReferalRegistry).
    mapping(address => bool) public authorizedGifters;

    /// @notice Total credits ever purchased.
    uint256 public totalCreditsPurchased;

    /// @notice Total credits ever gifted by owner.
    uint256 public totalCreditsGifted;

    // ──────────────────── Events ────────────────────

    event CreditsPurchased(address indexed user, address indexed token, uint256 tokenAmount, uint256 creditsReceived);
    event CreditsGifted(address indexed user, uint256 amount);
    event CreditsSpent(address indexed user, uint256 amount);
    event TokenRatioSet(address indexed token, uint256 ratio, bool allowed);
    event SpenderSet(address indexed spender, bool allowed);
    event GifterSet(address indexed gifter, bool allowed);

    // ──────────────────── Errors ────────────────────

    error TokenNotAllowed();
    error InsufficientCredits();
    error NotAuthorizedSpender();
    error NotAuthorizedGifter();
    error ZeroAmount();

    // ──────────────────── Constructor ────────────────────

    constructor(address _wildToken) Ownable(msg.sender) {
        wildToken = IERC20(_wildToken);
        // WILD itself is allowed at 1:1 ratio by default
        allowedToken[_wildToken] = true;
        tokenRatio[_wildToken] = 1e18;
    }

    // ──────────────────── User: Purchase credits ────────────────────

    /// @notice Purchase credits by depositing an allowed token.
    /// @param token The token to deposit.
    /// @param amount The amount of token to deposit (in token's decimals).
    function purchaseCredits(address token, uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (!allowedToken[token]) revert TokenNotAllowed();

        IERC20(token).transferFrom(msg.sender, address(this), amount);

        uint256 credits = amount * tokenRatio[token] / 1e18;
        balanceOf[msg.sender] += credits;
        totalCreditsPurchased += credits;

        emit CreditsPurchased(msg.sender, token, amount, credits);
    }

    // ──────────────────── Spender: Deduct credits ────────────────────

    /// @notice Spend credits from a user's balance. Only callable by authorized spenders.
    /// @param user The user whose credits to spend.
    /// @param amount The amount of credits to deduct (18 decimals).
    function spendCredits(address user, uint256 amount) external {
        if (!authorizedSpenders[msg.sender]) revert NotAuthorizedSpender();
        if (balanceOf[user] < amount) revert InsufficientCredits();
        balanceOf[user] -= amount;
        emit CreditsSpent(user, amount);
    }

    // ──────────────────── Owner: Admin ────────────────────

    /// @notice Gift credits to a user. Callable by owner or authorized gifters (e.g. ReferalRegistry).
    function giftCredits(address user, uint256 amount) external {
        if (msg.sender != owner() && !authorizedGifters[msg.sender]) revert NotAuthorizedGifter();
        if (amount == 0) revert ZeroAmount();
        balanceOf[user] += amount;
        totalCreditsGifted += amount;
        emit CreditsGifted(user, amount);
    }

    /// @notice Batch gift credits to multiple users. Callable by owner or authorized gifters.
    function batchGiftCredits(address[] calldata users, uint256[] calldata amounts) external {
        if (msg.sender != owner() && !authorizedGifters[msg.sender]) revert NotAuthorizedGifter();
        require(users.length == amounts.length, "Length mismatch");
        for (uint256 i = 0; i < users.length;) {
            balanceOf[users[i]] += amounts[i];
            totalCreditsGifted += amounts[i];
            emit CreditsGifted(users[i], amounts[i]);
            unchecked { ++i; }
        }
    }

    /// @notice Set conversion ratio and allowed status for a token.
    /// @param token The token address.
    /// @param ratio Credits per 1 full token (18 decimals). E.g. 2e18 = 2 credits per token.
    /// @param allowed Whether this token can be used to purchase credits.
    function setTokenRatio(address token, uint256 ratio, bool allowed) external onlyOwner {
        tokenRatio[token] = ratio;
        allowedToken[token] = allowed;
        emit TokenRatioSet(token, ratio, allowed);
    }

    /// @notice Set authorized spender (GameRouter or game contracts).
    function setSpender(address spender, bool allowed) external onlyOwner {
        authorizedSpenders[spender] = allowed;
        emit SpenderSet(spender, allowed);
    }

    /// @notice Set authorized gifter (e.g. ReferalRegistry).
    function setGifter(address gifter, bool allowed) external onlyOwner {
        authorizedGifters[gifter] = allowed;
        emit GifterSet(gifter, allowed);
    }

    /// @notice Update the WILD token address.
    function setWildToken(address _wildToken) external onlyOwner {
        wildToken = IERC20(_wildToken);
    }

    /// @notice Withdraw tokens received from credit purchases (owner revenue).
    function withdrawTokens(address token, uint256 amount, address to) external onlyOwner {
        IERC20(token).transfer(to, amount);
    }
}
