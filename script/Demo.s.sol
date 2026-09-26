// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {SessionAccount} from "../src/SessionAccount.sol";
import {MockAggregationRouter} from "../src/mocks/MockAggregationRouter.sol";

/// @notice Deploys the demo stack. Prefer `./demo.sh` (forge tests) for the talk.
///
///   anvil
///   forge script script/Demo.s.sol:DemoScript --rpc-url http://127.0.0.1:8545 --broadcast \
///     --private-key 0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80
contract DemoScript is Script {
    /// @dev Anvil account #0. Override with PRIVATE_KEY. Never a mainnet owner key.
    uint256 internal constant ANVIL_0 =
        0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80;

    function run() external {
        uint256 ownerPk = vm.envOr("PRIVATE_KEY", ANVIL_0);
        address owner = vm.addr(ownerPk);
        address session = vm.addr(vm.envOr("SESSION_PK", uint256(0x5E5510)));

        vm.startBroadcast(ownerPk);

        SessionAccount account = new SessionAccount(owner);
        MockAggregationRouter router = new MockAggregationRouter();
        payable(address(account)).transfer(1.84 ether);

        address[] memory targets = new address[](1);
        targets[0] = address(router);
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = MockAggregationRouter.swap.selector;
        account.arm(session, 0.05 ether, 15 minutes, targets, selectors);

        vm.stopBroadcast();

        console2.log("SessionAccount", address(account));
        console2.log("MockRouter    ", address(router));
        console2.log("owner         ", owner);
        console2.log("sessionKey    ", session);
    }
}
