// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script, console2} from "forge-std/Script.sol";
import {SessionAccount} from "../src/SessionAccount.sol";
import {MockAggregationRouter} from "../src/mocks/MockAggregationRouter.sol";

/// @notice Deploy + arm on Sepolia. This is setup, not the demo.
///         Next: ./sepolia-demo.sh drain  then  ./sepolia-demo.sh swap
///
///   forge script script/Sepolia.s.sol:SepoliaScript --rpc-url sepolia --broadcast --verify
contract SepoliaScript is Script {
    function run() external {
        uint256 ownerPk = vm.envUint("PRIVATE_KEY");
        uint256 sessionPk = vm.envUint("SESSION_PK");
        address owner = vm.addr(ownerPk);
        address session = vm.addr(sessionPk);

        vm.startBroadcast(ownerPk);

        SessionAccount account = new SessionAccount(owner);
        MockAggregationRouter router = new MockAggregationRouter();

        // Cap is 0.05 ETH. 0.06 lets the drain attempt exceed the cap.
        payable(address(account)).transfer(0.06 ether);
        // Session pays gas for execute() on Sepolia.
        payable(session).transfer(0.008 ether);

        address[] memory targets = new address[](1);
        targets[0] = address(router);
        bytes4[] memory selectors = new bytes4[](1);
        selectors[0] = MockAggregationRouter.swap.selector;
        account.arm(session, 0.05 ether, 15 minutes, targets, selectors);

        string memory ensName = vm.envOr("AGENT_ENS", string(""));
        if (bytes(ensName).length != 0) {
            account.setAgentEns(ensName);
        }

        vm.stopBroadcast();

        console2.log("ACCOUNT", address(account));
        console2.log("ROUTER", address(router));
        console2.log("OWNER", owner);
        console2.log("SESSION_KEY", session);
        console2.log("AGENT_ENS", account.agentEns());
        console2.log("Put ACCOUNT, the ENS name, and later the drain/swap hashes in web/public/chain.json");
        console2.log("  ./sepolia-demo.sh status");
        console2.log("  ./sepolia-demo.sh drain");
        console2.log("  ./sepolia-demo.sh swap");
    }
}
