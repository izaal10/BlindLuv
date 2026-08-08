// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {BlindLuv} from "../src/BlindLuv.sol";
import {MockUSDC} from "./mocks/MockUSDC.sol";
import {Ownable} from "openzeppelin-contracts/contracts/access/Ownable.sol";

contract BlindLuvTest is Test {
    BlindLuv internal blind;
    MockUSDC internal usdc;

    address internal owner = makeAddr("owner");
    address internal agent = makeAddr("agent");
    address internal alice = makeAddr("alice");
    address internal bob = makeAddr("bob");
    address internal carol = makeAddr("carol");

    uint96 internal constant STAKE = 100_000; // 0.10 USDC
    uint96 internal constant MIN_STAKE = 10_000; // 0.01 USDC
    uint64 internal constant STAKE_WINDOW = 1 hours;
    uint64 internal constant ATTENDANCE_WINDOW = 3 days;

    function setUp() public {
        usdc = new MockUSDC();
        blind = new BlindLuv(address(usdc), agent, MIN_STAKE, owner);

        for (uint256 i; i < 3; ++i) {
            address u = [alice, bob, carol][i];
            usdc.mint(u, 10_000_000);
            vm.prank(u);
            usdc.approve(address(blind), type(uint256).max);
            vm.prank(u);
            blind.commitProfile(keccak256(abi.encodePacked("profile", u)));
        }
    }

    function _open(address a, address b) internal returns (uint256 id) {
        vm.prank(agent);
        id = blind.openSession(a, b, 91, keccak256("proof"), STAKE, STAKE_WINDOW, ATTENDANCE_WINDOW);
    }

    // ---------------------------------------------------------------- profiles

    function test_commitProfile_storesAndRevokes() public {
        assertTrue(blind.hasProfile(alice));
        vm.prank(alice);
        blind.revokeProfile();
        assertFalse(blind.hasProfile(alice));
    }

    function test_openSession_revertsWithoutProfile() public {
        address dave = makeAddr("dave");
        vm.prank(agent);
        vm.expectRevert(abi.encodeWithSelector(BlindLuv.MissingProfile.selector, dave));
        blind.openSession(alice, dave, 80, keccak256("p"), STAKE, STAKE_WINDOW, ATTENDANCE_WINDOW);
    }

    // ------------------------------------------------------------------ access

    function test_openSession_onlyAgent() public {
        vm.prank(alice);
        vm.expectRevert(BlindLuv.NotAgent.selector);
        blind.openSession(alice, bob, 80, keccak256("p"), STAKE, STAKE_WINDOW, ATTENDANCE_WINDOW);
    }

    function test_setAgent_onlyOwner() public {
        vm.prank(alice);
        vm.expectRevert(abi.encodeWithSelector(Ownable.OwnableUnauthorizedAccount.selector, alice));
        blind.setAgent(alice, true);

        vm.prank(owner);
        blind.setAgent(alice, true);
        assertTrue(blind.isAgent(alice));
    }

    function test_openSession_rejectsScoreAbove100() public {
        vm.prank(agent);
        vm.expectRevert(BlindLuv.InvalidScore.selector);
        blind.openSession(alice, bob, 101, keccak256("p"), STAKE, STAKE_WINDOW, ATTENDANCE_WINDOW);
    }

    function test_openSession_rejectsStakeBelowMinimum() public {
        vm.prank(agent);
        vm.expectRevert(BlindLuv.StakeTooLow.selector);
        blind.openSession(alice, bob, 80, keccak256("p"), MIN_STAKE - 1, STAKE_WINDOW, ATTENDANCE_WINDOW);
    }

    // ------------------------------------------------------------------ escrow

    function test_unlocksOnlyAfterBothStakes() public {
        uint256 id = _open(alice, bob);
        assertFalse(blind.isUnlocked(id));

        vm.prank(alice);
        blind.stake(id);
        assertFalse(blind.isUnlocked(id), "one-sided payment must not reveal anything");

        vm.prank(bob);
        blind.stake(id);
        assertTrue(blind.isUnlocked(id));
        assertEq(uint8(blind.getSession(id).status), uint8(BlindLuv.Status.Active));
        assertEq(usdc.balanceOf(address(blind)), STAKE * 2);
    }

    function test_stake_rejectsOutsider() public {
        uint256 id = _open(alice, bob);
        vm.prank(carol);
        vm.expectRevert(BlindLuv.NotParticipant.selector);
        blind.stake(id);
    }

    function test_stake_rejectsDoubleStake() public {
        uint256 id = _open(alice, bob);
        vm.startPrank(alice);
        blind.stake(id);
        vm.expectRevert(BlindLuv.AlreadyStaked.selector);
        blind.stake(id);
        vm.stopPrank();
    }

    function test_stake_rejectsAfterDeadline() public {
        uint256 id = _open(alice, bob);
        vm.warp(block.timestamp + STAKE_WINDOW + 1);
        vm.prank(alice);
        vm.expectRevert(BlindLuv.DeadlinePassed.selector);
        blind.stake(id);
    }

    // --------------------------------------------------------------- lifecycle

    function test_bothAttend_refundsBoth() public {
        uint256 id = _open(alice, bob);
        uint256 beforeA = usdc.balanceOf(alice);
        uint256 beforeB = usdc.balanceOf(bob);

        vm.prank(alice);
        blind.stake(id);
        vm.prank(bob);
        blind.stake(id);

        vm.prank(alice);
        blind.confirmAttendance(id);
        vm.prank(bob);
        blind.confirmAttendance(id);

        assertEq(uint8(blind.getSession(id).status), uint8(BlindLuv.Status.Completed));
        assertEq(usdc.balanceOf(alice), beforeA, "stake is a commitment, not a fee");
        assertEq(usdc.balanceOf(bob), beforeB);
        assertEq(usdc.balanceOf(address(blind)), 0);
    }

    function test_noShow_attendeeTakesBothStakes() public {
        uint256 id = _open(alice, bob);
        uint256 beforeA = usdc.balanceOf(alice);
        uint256 beforeB = usdc.balanceOf(bob);

        vm.prank(alice);
        blind.stake(id);
        vm.prank(bob);
        blind.stake(id);

        vm.prank(alice);
        blind.confirmAttendance(id); // bob never shows

        vm.warp(block.timestamp + ATTENDANCE_WINDOW + 1);
        blind.settle(id);

        assertEq(uint8(blind.getSession(id).status), uint8(BlindLuv.Status.Forfeited));
        assertEq(usdc.balanceOf(alice), beforeA + STAKE);
        assertEq(usdc.balanceOf(bob), beforeB - STAKE);
    }

    function test_mutualNoShow_refundsBoth() public {
        uint256 id = _open(alice, bob);
        uint256 beforeA = usdc.balanceOf(alice);
        uint256 beforeB = usdc.balanceOf(bob);

        vm.prank(alice);
        blind.stake(id);
        vm.prank(bob);
        blind.stake(id);

        vm.warp(block.timestamp + ATTENDANCE_WINDOW + 1);
        blind.settle(id);

        assertEq(uint8(blind.getSession(id).status), uint8(BlindLuv.Status.Cancelled));
        assertEq(usdc.balanceOf(alice), beforeA);
        assertEq(usdc.balanceOf(bob), beforeB);
    }

    function test_settle_revertsBeforeDeadline() public {
        uint256 id = _open(alice, bob);
        vm.prank(alice);
        blind.stake(id);
        vm.prank(bob);
        blind.stake(id);

        vm.expectRevert(BlindLuv.DeadlineNotReached.selector);
        blind.settle(id);
    }

    function test_cancelExpired_refundsLoneStaker() public {
        uint256 id = _open(alice, bob);
        uint256 beforeA = usdc.balanceOf(alice);

        vm.prank(alice);
        blind.stake(id);
        vm.warp(block.timestamp + STAKE_WINDOW + 1);

        blind.cancelExpired(id); // anyone may rescue a stuck stake
        assertEq(usdc.balanceOf(alice), beforeA);
        assertEq(uint8(blind.getSession(id).status), uint8(BlindLuv.Status.Cancelled));
    }

    function test_confirmAttendance_rejectsAfterWindow() public {
        uint256 id = _open(alice, bob);
        vm.prank(alice);
        blind.stake(id);
        vm.prank(bob);
        blind.stake(id);

        vm.warp(block.timestamp + ATTENDANCE_WINDOW + 1);
        vm.prank(alice);
        vm.expectRevert(BlindLuv.DeadlinePassed.selector);
        blind.confirmAttendance(id);
    }

    function test_getSession_revertsForUnknownId() public {
        vm.expectRevert(BlindLuv.UnknownSession.selector);
        blind.getSession(999);
    }

    // ------------------------------------------------------------------- fuzz

    function testFuzz_stakeRoundTripsExactly(uint96 amount) public {
        amount = uint96(bound(amount, MIN_STAKE, 1_000_000));
        vm.prank(agent);
        uint256 id = blind.openSession(alice, bob, 70, keccak256("p"), amount, STAKE_WINDOW, ATTENDANCE_WINDOW);

        uint256 beforeA = usdc.balanceOf(alice);
        uint256 beforeB = usdc.balanceOf(bob);

        vm.prank(alice);
        blind.stake(id);
        vm.prank(bob);
        blind.stake(id);
        vm.prank(alice);
        blind.confirmAttendance(id);
        vm.prank(bob);
        blind.confirmAttendance(id);

        assertEq(usdc.balanceOf(alice), beforeA);
        assertEq(usdc.balanceOf(bob), beforeB);
        assertEq(usdc.balanceOf(address(blind)), 0);
    }
}
