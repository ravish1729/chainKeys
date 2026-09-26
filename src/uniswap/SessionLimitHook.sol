// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SessionAccount} from "../SessionAccount.sol";

/// @title SessionLimitHook
/// @notice Uniswap v4-style `beforeSwap` hook. Session accounts cannot swap more than
///         their session cap, even if they call the pool directly (bypassing `execute`).
///         EOAs and unrelated contracts pass through.
/// @dev Production would implement `IHooks` from v4-core and set hook flags in the PoolKey.
contract SessionLimitHook {
    error SessionCapExceeded();

    bytes4 public constant BEFORE_SWAP_SELECTOR = this.beforeSwap.selector;

    /// @dev v4 calls this on the PoolManager before mutating reserves. `sender` is the
    ///      swap initiator — for Chainkeys, the SessionAccount.
    function beforeSwap(
        address sender,
        int256 amountSpecified
    ) external view returns (bytes4) {
        uint256 size;
        assembly {
            size := extcodesize(sender)
        }
        if (size == 0) return BEFORE_SWAP_SELECTOR;

        try SessionAccount(payable(sender)).maxValue() returns (uint256 cap) {
            uint256 amt =
                amountSpecified >= 0 ? uint256(amountSpecified) : uint256(-amountSpecified);
            if (amt > cap || SessionAccount(payable(sender)).spent() > cap) {
                revert SessionCapExceeded();
            }
        } catch {}

        return BEFORE_SWAP_SELECTOR;
    }
}
