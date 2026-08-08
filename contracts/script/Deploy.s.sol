// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console} from "forge-std/Script.sol";
import {BlindLuv} from "../src/BlindLuv.sol";

/// @notice Deploys BlindLuv to Monad testnet.
///
/// Preferred path is the `wallet/` monskill (Alchemy Agent Wallet session +
/// CREATE2 through the canonical CreateX factory at
/// 0xba5Ed099633D3B313e4D5F7bdc1305d3c28ba5Ed) so no private key is ever held
/// locally. This script is the plain-forge fallback.
///
///   forge script script/Deploy.s.sol:Deploy \
///     --rpc-url monad_testnet --broadcast
contract Deploy is Script {
    /// Circle USDC on Monad testnet — verified to have code and EIP-3009.
    address constant USDC_TESTNET = 0x534b2f3A21130d7a60830c2Df862319e593943A3;

    function run() external returns (BlindLuv blind) {
        address usdc = vm.envOr("STAKE_TOKEN", USDC_TESTNET);
        address agent = vm.envOr("AGENT_ADDRESS", address(0));
        address owner = vm.envOr("OWNER_ADDRESS", msg.sender);
        uint96 minStake = uint96(vm.envOr("MIN_STAKE", uint256(10_000))); // 0.01 USDC

        vm.startBroadcast();
        blind = new BlindLuv(usdc, agent, minStake, owner);
        vm.stopBroadcast();

        console.log("BlindLuv deployed:", address(blind));
        console.log("  stakeToken:", usdc);
        console.log("  agent:     ", agent);
        console.log("  owner:     ", owner);
        console.log("  minStake:  ", minStake);
    }
}
