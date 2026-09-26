// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Stand-in for 1inch AggregationRouterV6 / a Uniswap-style pool.
///         Production would call the real router; tests must not depend on mainnet.
contract MockAggregationRouter {
    event Swapped(
        address indexed account, address indexed tokenOut, uint256 amountIn, uint256 amountOut
    );

    /// @dev Fake 1inch `swap`: spend `msg.value` ETH, return a dummy USDC amount.
    function swap(
        address tokenOut
    ) external payable returns (uint256 amountOut) {
        require(msg.value > 0, "zero in");
        // 1 ETH ≈ 3412 USDC in the dummy UI. Scale that here (6 decimals).
        amountOut = (msg.value * 3412 * 1e6) / 1 ether;
        emit Swapped(msg.sender, tokenOut, msg.value, amountOut);
    }
}

interface ISwapHook {
    function beforeSwap(
        address sender,
        int256 amountSpecified
    ) external view returns (bytes4);
}

/// @notice Second allowlisted target so the policy can list two routers.
///         Optional Uniswap v4-style hook runs before the swap lands.
contract MockPoolManager {
    address public hook;

    event Swapped(address indexed account, address indexed tokenOut, uint256 amountIn);

    function setHook(
        address hook_
    ) external {
        hook = hook_;
    }

    function swap(
        address tokenOut
    ) external payable {
        require(msg.value > 0, "zero in");
        if (hook != address(0)) {
            ISwapHook(hook).beforeSwap(msg.sender, int256(uint256(msg.value)));
        }
        emit Swapped(msg.sender, tokenOut, msg.value);
    }
}
