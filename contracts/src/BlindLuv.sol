// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "openzeppelin-contracts/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "openzeppelin-contracts/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";
import {ReentrancyGuard} from "openzeppelin-contracts/contracts/utils/ReentrancyGuard.sol";

/// @title BlindLuv — autonomous privacy dating settlement on Monad
/// @notice Stores only what needs to be trustless: who is matched, the AI
///         compatibility score, a commitment to the (off-chain, encrypted)
///         profile data, and the mutual USDC stake that turns a blind match
///         into an economic commitment.
///
///         Deliberately NOT on-chain: names, photos, ages, locations, interest
///         vectors, chat history, venue details. Those live off-chain and are
///         bound to the chain only through `profileCommitment` and `matchProof`
///         hashes, so anyone can later verify that a match was computed over
///         the data it claims — without that data ever being public.
///
/// @dev Gas note (Monad): cold SLOAD costs 8,100 gas versus 2,100 on Ethereum,
///      and users are charged on `gas_limit` rather than gas used. Session state
///      is therefore packed into four slots and every external function reads
///      each slot at most once.
contract BlindLuv is Ownable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Types
    // ---------------------------------------------------------------------

    enum Status {
        None, // 0 — session id never issued
        Pending, // 1 — created by an agent, waiting on one or both stakes
        Active, // 2 — both sides staked; identity + chat + venue unlocked
        Completed, // 3 — both sides confirmed attendance; stakes returned
        Forfeited, // 4 — one side no-showed; attendee took both stakes
        Cancelled // 5 — expired before both sides staked; stakes returned
    }

    struct Session {
        // slot 0
        address userA; // 160 bits
        uint8 score; // 8   — AI compatibility score, 0..100
        Status status; // 8
        bool stakedA; // 8
        bool stakedB; // 8
        bool confirmedA; // 8
        bool confirmedB; // 8
        // slot 1
        address userB; // 160 bits
        uint96 stakeAmount; // 96  — per participant, in USDC base units (6 dp)
        // slot 2
        bytes32 matchProof; // commitment to the AI reasoning + both profiles
        // slot 3
        uint64 stakeDeadline; // 64  — both stakes must land before this
        uint64 attendanceDeadline; // 64  — attendance window closes here
        address agent; // 160 — AI matchmaker that produced this match
    }

    // ---------------------------------------------------------------------
    // Storage
    // ---------------------------------------------------------------------

    /// @notice USDC (or any EIP-20) used for stakes. Immutable so the escrow
    ///         asset can never be swapped out from under staked users.
    IERC20 public immutable stakeToken;

    /// @notice Hash of a user's encrypted profile + AI interest vector.
    ///         Proves the profile existed at match time, reveals nothing.
    mapping(address user => bytes32 commitment) public profileCommitment;

    /// @notice AI agent wallets allowed to open sessions.
    mapping(address agent => bool allowed) public isAgent;

    mapping(uint256 sessionId => Session) private _sessions;

    uint256 public nextSessionId = 1;

    /// @notice Minimum stake per participant, in USDC base units.
    uint96 public minStake;

    // ---------------------------------------------------------------------
    // Events
    // ---------------------------------------------------------------------

    event ProfileCommitted(address indexed user, bytes32 commitment);
    event ProfileRevoked(address indexed user);
    event AgentUpdated(address indexed agent, bool allowed);
    event MinStakeUpdated(uint96 minStake);

    event SessionOpened(
        uint256 indexed sessionId,
        address indexed userA,
        address indexed userB,
        address agent,
        uint8 score,
        uint96 stakeAmount,
        bytes32 matchProof
    );
    event Staked(uint256 indexed sessionId, address indexed user, uint96 amount);
    /// @notice Both sides paid. Off-chain services key identity/chat/venue
    ///         disclosure off this event.
    event SessionUnlocked(uint256 indexed sessionId, uint64 attendanceDeadline);
    event AttendanceConfirmed(uint256 indexed sessionId, address indexed user);
    event SessionCompleted(uint256 indexed sessionId, uint96 refundEach);
    event SessionForfeited(uint256 indexed sessionId, address indexed attendee, address indexed noShow, uint96 payout);
    event SessionCancelled(uint256 indexed sessionId);

    // ---------------------------------------------------------------------
    // Errors
    // ---------------------------------------------------------------------

    error NotAgent();
    error NotParticipant();
    error UnknownSession();
    error WrongStatus(Status expected, Status actual);
    error SameUser();
    error MissingProfile(address user);
    error InvalidScore();
    error StakeTooLow();
    error AlreadyStaked();
    error AlreadyConfirmed();
    error DeadlinePassed();
    error DeadlineNotReached();
    error BothConfirmed();
    error ZeroAddress();

    // ---------------------------------------------------------------------
    // Construction
    // ---------------------------------------------------------------------

    constructor(address stakeToken_, address initialAgent, uint96 minStake_, address owner_) Ownable(owner_) {
        if (stakeToken_ == address(0) || owner_ == address(0)) revert ZeroAddress();
        stakeToken = IERC20(stakeToken_);
        minStake = minStake_;
        emit MinStakeUpdated(minStake_);
        if (initialAgent != address(0)) {
            isAgent[initialAgent] = true;
            emit AgentUpdated(initialAgent, true);
        }
    }

    // ---------------------------------------------------------------------
    // Profiles
    // ---------------------------------------------------------------------

    /// @notice Publish (or rotate) the commitment to your off-chain profile.
    /// @param commitment keccak256 over the encrypted profile blob and the AI
    ///        interest vector, salted client-side. ~46k gas on a first write.
    function commitProfile(bytes32 commitment) external {
        if (commitment == bytes32(0)) revert MissingProfile(msg.sender);
        profileCommitment[msg.sender] = commitment;
        emit ProfileCommitted(msg.sender, commitment);
    }

    /// @notice Withdraw from matching. Existing sessions are unaffected.
    function revokeProfile() external {
        delete profileCommitment[msg.sender];
        emit ProfileRevoked(msg.sender);
    }

    // ---------------------------------------------------------------------
    // Matching
    // ---------------------------------------------------------------------

    /// @notice Called by an authorised AI matchmaker once both users have
    ///         accepted an anonymous card. Records the score and a proof hash
    ///         binding the match to the profiles it was computed over.
    /// @param stakeAmount Per-participant stake. Both sides pay the same, so
    ///        neither can buy a cheaper option on the other's time.
    /// @param stakeWindow Seconds allowed for both stakes to land.
    /// @param attendanceWindow Seconds after unlock in which attendance must be
    ///        confirmed. Monad blocks are ~400ms, so use real durations here
    ///        rather than block counts.
    function openSession(
        address userA,
        address userB,
        uint8 score,
        bytes32 matchProof,
        uint96 stakeAmount,
        uint64 stakeWindow,
        uint64 attendanceWindow
    ) external returns (uint256 sessionId) {
        if (!isAgent[msg.sender]) revert NotAgent();
        if (userA == userB) revert SameUser();
        if (userA == address(0) || userB == address(0)) revert ZeroAddress();
        if (score > 100) revert InvalidScore();
        if (stakeAmount < minStake) revert StakeTooLow();
        if (profileCommitment[userA] == bytes32(0)) revert MissingProfile(userA);
        if (profileCommitment[userB] == bytes32(0)) revert MissingProfile(userB);

        sessionId = nextSessionId++;

        Session storage s = _sessions[sessionId];
        s.userA = userA;
        s.userB = userB;
        s.score = score;
        s.status = Status.Pending;
        s.stakeAmount = stakeAmount;
        s.matchProof = matchProof;
        s.agent = msg.sender;
        s.stakeDeadline = uint64(block.timestamp) + stakeWindow;
        // Set once both sides have staked; `attendanceWindow` is remembered by
        // reusing the field until then.
        s.attendanceDeadline = attendanceWindow;

        emit SessionOpened(sessionId, userA, userB, msg.sender, score, stakeAmount, matchProof);
    }

    // ---------------------------------------------------------------------
    // Escrow
    // ---------------------------------------------------------------------

    /// @notice Stake your half. Requires a prior ERC-20 approval for
    ///         `stakeAmount`. The second staker's transaction is the one that
    ///         unlocks the session.
    /// @dev Fixed cost, ~95k gas cold / ~120k for the unlocking call. Set an
    ///      explicit gas limit in the frontend: Monad charges on the limit, so
    ///      an inflated estimate is money out of the user's pocket.
    function stake(uint256 sessionId) external nonReentrant {
        Session storage s = _sessions[sessionId];
        if (s.status != Status.Pending) revert WrongStatus(Status.Pending, s.status);
        if (block.timestamp > s.stakeDeadline) revert DeadlinePassed();

        bool isA = msg.sender == s.userA;
        if (!isA && msg.sender != s.userB) revert NotParticipant();
        if (isA ? s.stakedA : s.stakedB) revert AlreadyStaked();

        uint96 amount = s.stakeAmount;
        if (isA) s.stakedA = true;
        else s.stakedB = true;

        stakeToken.safeTransferFrom(msg.sender, address(this), amount);
        emit Staked(sessionId, msg.sender, amount);

        if (s.stakedA && s.stakedB) {
            uint64 deadline = uint64(block.timestamp) + s.attendanceDeadline;
            s.attendanceDeadline = deadline;
            s.status = Status.Active;
            emit SessionUnlocked(sessionId, deadline);
        }
    }

    /// @notice Confirm you showed up. When both sides confirm, both stakes are
    ///         returned in full — the stake is a commitment device, not a fee.
    function confirmAttendance(uint256 sessionId) external nonReentrant {
        Session storage s = _sessions[sessionId];
        if (s.status != Status.Active) revert WrongStatus(Status.Active, s.status);
        if (block.timestamp > s.attendanceDeadline) revert DeadlinePassed();

        bool isA = msg.sender == s.userA;
        if (!isA && msg.sender != s.userB) revert NotParticipant();
        if (isA ? s.confirmedA : s.confirmedB) revert AlreadyConfirmed();

        if (isA) s.confirmedA = true;
        else s.confirmedB = true;
        emit AttendanceConfirmed(sessionId, msg.sender);

        if (s.confirmedA && s.confirmedB) {
            uint96 amount = s.stakeAmount;
            address a = s.userA;
            address b = s.userB;
            s.status = Status.Completed;

            stakeToken.safeTransfer(a, amount);
            stakeToken.safeTransfer(b, amount);
            emit SessionCompleted(sessionId, amount);
        }
    }

    /// @notice After the attendance window closes, the party that confirmed
    ///         claims both stakes. If neither confirmed, both are refunded —
    ///         a mutual no-show is nobody's fault to profit from.
    function settle(uint256 sessionId) external nonReentrant {
        Session storage s = _sessions[sessionId];
        if (s.status != Status.Active) revert WrongStatus(Status.Active, s.status);
        if (block.timestamp <= s.attendanceDeadline) revert DeadlineNotReached();

        bool confirmedA = s.confirmedA;
        bool confirmedB = s.confirmedB;
        if (confirmedA && confirmedB) revert BothConfirmed(); // handled in confirmAttendance

        uint96 amount = s.stakeAmount;
        address a = s.userA;
        address b = s.userB;

        if (!confirmedA && !confirmedB) {
            s.status = Status.Cancelled;
            stakeToken.safeTransfer(a, amount);
            stakeToken.safeTransfer(b, amount);
            emit SessionCancelled(sessionId);
            return;
        }

        address attendee = confirmedA ? a : b;
        address noShow = confirmedA ? b : a;
        s.status = Status.Forfeited;

        uint96 payout = amount * 2;
        stakeToken.safeTransfer(attendee, payout);
        emit SessionForfeited(sessionId, attendee, noShow, payout);
    }

    /// @notice Reclaim a stake when the other side never paid and the window
    ///         closed. Callable by anyone so a stuck user can be rescued.
    function cancelExpired(uint256 sessionId) external nonReentrant {
        Session storage s = _sessions[sessionId];
        if (s.status != Status.Pending) revert WrongStatus(Status.Pending, s.status);
        if (block.timestamp <= s.stakeDeadline) revert DeadlineNotReached();

        uint96 amount = s.stakeAmount;
        bool stakedA = s.stakedA;
        bool stakedB = s.stakedB;
        address a = s.userA;
        address b = s.userB;
        s.status = Status.Cancelled;

        if (stakedA) stakeToken.safeTransfer(a, amount);
        if (stakedB) stakeToken.safeTransfer(b, amount);
        emit SessionCancelled(sessionId);
    }

    // ---------------------------------------------------------------------
    // Views
    // ---------------------------------------------------------------------

    function getSession(uint256 sessionId) external view returns (Session memory) {
        Session memory s = _sessions[sessionId];
        if (s.status == Status.None) revert UnknownSession();
        return s;
    }

    /// @notice True once both stakes have landed — the single check an
    ///         off-chain reveal service needs before disclosing identities.
    function isUnlocked(uint256 sessionId) external view returns (bool) {
        Status st = _sessions[sessionId].status;
        return st == Status.Active || st == Status.Completed || st == Status.Forfeited;
    }

    function hasProfile(address user) external view returns (bool) {
        return profileCommitment[user] != bytes32(0);
    }

    // ---------------------------------------------------------------------
    // Admin
    // ---------------------------------------------------------------------

    function setAgent(address agent, bool allowed) external onlyOwner {
        if (agent == address(0)) revert ZeroAddress();
        isAgent[agent] = allowed;
        emit AgentUpdated(agent, allowed);
    }

    function setMinStake(uint96 minStake_) external onlyOwner {
        minStake = minStake_;
        emit MinStakeUpdated(minStake_);
    }
}
