// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {IReferalRegistry} from "../interfaces/IReferalRegistry.sol";
import {IReferalLogic} from "../interfaces/IReferalLogic.sol";

/// @title  ReferalLogicV1
/// @notice Referral business logic: direct (1-level) referrals with a 5-tier
///         level system. The referrer's level (1–5) determines their commission
///         percentage and is re-evaluated weekly based on the USD volume their
///         referrals generate.
///
/// Level → Commission:
///   5 → 0.50%  (50 bps)
///   4 → 0.40%  (40 bps)
///   3 → 0.30%  (30 bps)
///   2 → 0.20%  (20 bps)
///   1 → 0.10%  (10 bps)
///
/// Weekly milestone: volume_USD ≥ baseUSD × level  → keeps/reaches that level.
///   Evaluation is lazy: triggered on the first bet of a new week per referrer.
///
/// Upgrade path:
///   1. Deploy ReferalLogicV2 with new rules
///   2. registry.setWriter(v2, true) + registry.setWriter(v1, false)
///   3. GameRouter.setReferalLogic(v2)
contract ReferalLogicV1 is Ownable, IReferalLogic {

    // ──────────────────── Constants ────────────────────

    uint256 public constant BPS_DENOMINATOR  = 10_000;
    uint256 public constant BPS_PER_LEVEL    = 10;     // level N → N * 10 bps
    uint8   public constant MAX_LEVEL        = 5;
    uint8   public constant MIN_LEVEL        = 1;
    uint256 public constant WEEK             = 7 days;
    uint256 public constant PRICE_DECIMALS   = 1e18;

    // ──────────────────── State ────────────────────

    IReferalRegistry public registry;

    /// @notice Base USD milestone (18 decimals). e.g. 100e18 = $100/week for level 1.
    uint256 public baseUSD;

    /// @notice USD price of each token (18 decimals). e.g. USDC → 1e18, WILD → 0.1e18.
    ///         If 0, the token's volume is not counted toward milestones
    ///         (commission still pays out in that token).
    mapping(address => uint256) public tokenPriceUSD;

    /// @notice Current referrer level (1–5). 0 means the referrer hasn't been initialized yet.
    mapping(address => uint8) public referrerLevel;

    /// @notice Accumulated USD volume (18 dec) for the referrer in the current period.
    mapping(address => uint256) public currentWeekVolume;

    /// @notice Week number (block.timestamp / WEEK) of the last level evaluation.
    mapping(address => uint256) public lastEvaluationWeek;

    /// @notice Contracts allowed to call onBet (GameRouter, future routers).
    mapping(address => bool) public authorizedCallers;

    // ──────────────────── Events ────────────────────

    event BetRecorded(
        address indexed player,
        address indexed referrer,
        address indexed token,
        uint256 betAmount,
        uint256 rewardAmount
    );
    event LevelUpdated(address indexed referrer, uint8 newLevel, uint256 weekVolume);
    event ReferrerInitialized(address indexed referrer, uint8 level);
    event TokenPriceSet(address indexed token, uint256 priceUSD);
    event BaseUSDSet(uint256 baseUSD);
    event CallerSet(address indexed caller, bool allowed);

    // ──────────────────── Errors ────────────────────

    error NotAuthorizedCaller();
    error BaseUSDZero();

    // ──────────────────── Modifiers ────────────────────

    modifier onlyCaller() {
        if (!authorizedCallers[msg.sender]) revert NotAuthorizedCaller();
        _;
    }

    // ──────────────────── Constructor ────────────────────

    constructor(
        address _registry,
        uint256 _baseUSD
    ) Ownable(msg.sender) {
        if (_baseUSD == 0) revert BaseUSDZero();
        registry = IReferalRegistry(_registry);
        baseUSD  = _baseUSD;
    }

    // ──────────────────── Core logic ────────────────────

    /// @notice Called by GameRouter on every bet.
    ///         1. On player's first bet: locks their referral slot (registers `referrer` if provided).
    ///         2. Lazy-evaluates the referrer's level if a new week has started.
    ///         3. Accumulates USD volume for the referrer.
    ///         4. Accrues the commission (in bet token) to the referrer.
    function onBet(
        address player,
        address token,
        uint256 betAmount,
        address referrer
    ) external onlyCaller {
        // ── Step 1: lock referral slot on first bet ──
        if (!registry.referralLocked(player)) {
            registry.lockAndRegister(player, referrer);

            // Initialize the referrer at max level if this is their first referral
            if (referrer != address(0) && referrer != player && referrerLevel[referrer] == 0) {
                referrerLevel[referrer]      = MAX_LEVEL;
                lastEvaluationWeek[referrer] = _currentWeek();
                emit ReferrerInitialized(referrer, MAX_LEVEL);
            }
        }

        // ── Step 2: resolve who the referrer is (may have been pre-registered) ──
        address ref = registry.referrerOf(player);
        if (ref == address(0)) return;

        // ── Step 3: lazy level evaluation at week boundary ──
        uint256 week = _currentWeek();
        if (week > lastEvaluationWeek[ref]) {
            _evaluateLevel(ref);
            currentWeekVolume[ref]    = 0;
            lastEvaluationWeek[ref]   = week;
        }

        // ── Step 4: accumulate USD volume ──
        uint256 priceUSD = tokenPriceUSD[token];
        if (priceUSD > 0) {
            currentWeekVolume[ref] += (betAmount * priceUSD) / PRICE_DECIMALS;
        }

        // ── Step 5: accrue commission in the original token ──
        uint8 level = referrerLevel[ref];
        if (level == 0) level = MIN_LEVEL; // safety: treat uninitialized as level 1
        uint256 reward = (betAmount * uint256(level) * BPS_PER_LEVEL) / BPS_DENOMINATOR;

        if (reward > 0) {
            registry.accrueReward(ref, token, reward);
            emit BetRecorded(player, ref, token, betAmount, reward);
        }
    }

    // ──────────────────── Internal ────────────────────

    function _currentWeek() internal view returns (uint256) {
        return block.timestamp / WEEK;
    }

    /// @dev Re-calculate and store the referrer's level based on accumulated weekly USD volume.
    ///      Called at the start of a new week before resetting the volume counter.
    function _evaluateLevel(address ref) internal {
        uint256 vol  = currentWeekVolume[ref];
        uint256 base = baseUSD;
        uint8 newLevel;

        if      (vol >= base * 5) newLevel = 5;
        else if (vol >= base * 4) newLevel = 4;
        else if (vol >= base * 3) newLevel = 3;
        else if (vol >= base * 2) newLevel = 2;
        else                      newLevel = 1;

        referrerLevel[ref] = newLevel;
        emit LevelUpdated(ref, newLevel, vol);
    }

    // ──────────────────── Admin ────────────────────

    /// @notice Set the USD price (18 dec) for a token. 0 = exclude from volume counting.
    function setTokenPrice(address token, uint256 priceUSD) external onlyOwner {
        tokenPriceUSD[token] = priceUSD;
        emit TokenPriceSet(token, priceUSD);
    }

    /// @notice Set multiple token prices in one call.
    function setTokenPrices(address[] calldata tokens, uint256[] calldata prices) external onlyOwner {
        require(tokens.length == prices.length, "length mismatch");
        for (uint256 i = 0; i < tokens.length; i++) {
            tokenPriceUSD[tokens[i]] = prices[i];
            emit TokenPriceSet(tokens[i], prices[i]);
        }
    }

    /// @notice Update the base USD milestone. Must be > 0.
    function setBaseUSD(uint256 _baseUSD) external onlyOwner {
        if (_baseUSD == 0) revert BaseUSDZero();
        baseUSD = _baseUSD;
        emit BaseUSDSet(_baseUSD);
    }

    /// @notice Grant or revoke call access (GameRouter or future entry points).
    function setCaller(address caller, bool allowed) external onlyOwner {
        authorizedCallers[caller] = allowed;
        emit CallerSet(caller, allowed);
    }

    /// @notice Point to a different registry (edge case migration).
    function setRegistry(address _registry) external onlyOwner {
        registry = IReferalRegistry(_registry);
    }

    // ──────────────────── View helpers ────────────────────

    /// @notice Returns the commission BPS for a given level.
    function levelToBps(uint8 level) external pure returns (uint256) {
        return uint256(level) * BPS_PER_LEVEL;
    }

    /// @notice Returns the USD volume threshold required to reach or maintain a level.
    function levelThreshold(uint8 level) external view returns (uint256) {
        return baseUSD * uint256(level);
    }
}
