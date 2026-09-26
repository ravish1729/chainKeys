// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Ownable} from "@openzeppelin/contracts/access/Ownable.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EnumerableSet} from "@openzeppelin/contracts/utils/structs/EnumerableSet.sol";

/// @title SessionAccount
/// @notice Smart account: a human **owner** plus a constrained **session key** (the agent).
///
/// @dev How to read this file
///      OpenZeppelin owns the boring / easy-to-get-wrong pieces:
///        Ownable          — who is the human; `onlyOwner`; `transferOwnership`
///        EIP712 + ECDSA   — typed-data hash + recover signer (relayer path)
///        ReentrancyGuard  — session execute cannot re-enter while a swap is mid-call
///        EnumerableSet    — allowlisted routers / selectors without a custom mapping+array
///      We write the product: cap, TTL, allowlist, selector. That is what reverts a drain.
contract SessionAccount is Ownable, EIP712, ReentrancyGuard {
    using EnumerableSet for EnumerableSet.AddressSet;
    using EnumerableSet for EnumerableSet.Bytes4Set;

    // --- policy violation bitmask (preview reports every failing check) ---
    uint256 public constant VIOLATION_TARGET = 1 << 0;
    uint256 public constant VIOLATION_VALUE = 1 << 1;
    uint256 public constant VIOLATION_SELECTOR = 1 << 2;
    uint256 public constant VIOLATION_EXPIRED = 1 << 3;
    uint256 public constant VIOLATION_NOT_ARMED = 1 << 4;
    uint256 public constant VIOLATION_SIGNER = 1 << 5;
    uint256 public constant VIOLATION_PER_CALL = 1 << 6;
    uint256 public constant VIOLATION_CALLS = 1 << 7;
    uint256 public constant VIOLATION_TOKEN = 1 << 8;

    bytes4 public constant SWAP_SELECTOR = 0x03438dd0;

    /// @dev EIP-712 struct. Wallets show these fields when the agent signs.
    bytes32 public constant EXECUTE_TYPEHASH =
        keccak256("Execute(address to,uint256 value,bytes32 dataHash,uint256 nonce)");

    address public sessionKey;
    uint256 public maxValue;
    uint256 public maxPerCall;
    uint256 public maxCalls;
    uint256 public spent;
    uint256 public calls;
    uint256 public expiry;
    bool public armed;
    uint256 public nonce;
    /// @dev ENSv2 agent subname, e.g. "agent.ravish.eth". Empty until named.
    string public agentEns;

    EnumerableSet.AddressSet private _targets;
    EnumerableSet.Bytes4Set private _selectors;
    EnumerableSet.AddressSet private _tokens;

    error NotSessionKey();
    error PolicyViolation(uint256 code);
    error CannotRenounce();

    event Armed(
        address indexed sessionKey,
        uint256 maxValue,
        uint256 maxPerCall,
        uint256 maxCalls,
        uint256 expiry,
        address[] targets,
        bytes4[] selectors,
        address[] tokens
    );
    event AgentNamed(string agentEns);
    event Revoked(address indexed sessionKey);
    event Executed(address indexed signer, address indexed to, uint256 value, bytes4 selector);

    constructor(
        address initialOwner
    ) Ownable(initialOwner) EIP712("Chainkeys", "1") {}

    receive() external payable {}

    // -------------------------------------------------------------------------
    // Owner (OpenZeppelin `onlyOwner`). Session key cannot call these.
    // -------------------------------------------------------------------------

    /// @notice Install a session key and freeze the spend policy.
    /// @param key                Agent-only EOA. Cannot change policy.
    /// @param maxValue_          Native-ETH cap for the whole session (e.g. 0.05 ether).
    /// @param ttl                Seconds until expiry (e.g. 15 minutes).
    /// @param allowedTargets_    Allowlisted callees (1inch router, Uniswap PoolManager).
    /// @param allowedSelectors_  Allowlisted function selectors (e.g. swap only).
    function arm(
        address key,
        uint256 maxValue_,
        uint256 ttl,
        address[] calldata allowedTargets_,
        bytes4[] calldata allowedSelectors_
    ) external onlyOwner {
        _arm(key, maxValue_, 0, ttl, 0, allowedTargets_, allowedSelectors_, new address[](0));
    }

    /// @notice Full policy: session cap, per-tx cap, TTL, call budget, routers, selectors, tokens.
    function arm(
        address key,
        uint256 maxValue_,
        uint256 ttl,
        address[] calldata allowedTargets_,
        bytes4[] calldata allowedSelectors_,
        uint256 maxPerCall_,
        uint256 maxCalls_,
        address[] calldata allowedTokens_
    ) external onlyOwner {
        _arm(
            key,
            maxValue_,
            maxPerCall_,
            ttl,
            maxCalls_,
            allowedTargets_,
            allowedSelectors_,
            allowedTokens_
        );
    }

    function _arm(
        address key,
        uint256 maxValue_,
        uint256 maxPerCall_,
        uint256 ttl,
        uint256 maxCalls_,
        address[] calldata allowedTargets_,
        bytes4[] calldata allowedSelectors_,
        address[] memory allowedTokens_
    ) internal {
        if (key == address(0) || key == owner()) revert NotSessionKey();

        _targets.clear();
        _selectors.clear();
        _tokens.clear();

        sessionKey = key;
        maxValue = maxValue_;
        maxPerCall = maxPerCall_;
        maxCalls = maxCalls_;
        spent = 0;
        calls = 0;
        expiry = block.timestamp + ttl;
        armed = true;

        for (uint256 i; i < allowedTargets_.length; ++i) {
            _targets.add(allowedTargets_[i]);
        }
        for (uint256 i; i < allowedSelectors_.length; ++i) {
            _selectors.add(allowedSelectors_[i]);
        }
        for (uint256 i; i < allowedTokens_.length; ++i) {
            _tokens.add(allowedTokens_[i]);
        }

        emit Armed(
            key,
            maxValue_,
            maxPerCall_,
            maxCalls_,
            expiry,
            allowedTargets_,
            allowedSelectors_,
            allowedTokens_
        );
    }

    /// @notice Record the ENSv2 agent subname. Session key cannot call this.
    function setAgentEns(
        string calldata agentEns_
    ) external onlyOwner {
        _setAgentEns(agentEns_);
    }

    function revoke() external onlyOwner {
        address key = sessionKey;
        armed = false;
        sessionKey = address(0);
        spent = 0;
        calls = 0;
        _setAgentEns("");
        emit Revoked(key);
    }

    /// @notice Human path. Full control of funds. Policy does not apply.
    function executeAsOwner(
        address to,
        uint256 value,
        bytes calldata data
    ) external onlyOwner nonReentrant returns (bytes memory) {
        return _call(to, value, data, owner());
    }

    /// @dev An ownerless account could never re-arm or recover funds.
    function renounceOwnership() public view override onlyOwner {
        revert CannotRenounce();
    }

    // -------------------------------------------------------------------------
    // Session: constrained execute. Direct (agent pays gas) or signed (relayer).
    // -------------------------------------------------------------------------

    /// @notice Session key calls this itself (`msg.sender == sessionKey`).
    function execute(
        address to,
        uint256 value,
        bytes calldata data
    ) external nonReentrant returns (bytes memory) {
        if (msg.sender != sessionKey) revert NotSessionKey();
        _enforcePolicy(to, value, data);
        spent += value;
        unchecked {
            ++calls;
        }
        return _call(to, value, data, sessionKey);
    }

    /// @notice Relayer submits a session-key EIP-712 signature. Anyone may call.
    function executeSigned(
        address to,
        uint256 value,
        bytes calldata data,
        bytes calldata signature
    ) external nonReentrant returns (bytes memory) {
        address signer = ECDSA.recoverCalldata(hashExecute(to, value, data), signature);
        if (signer != sessionKey) {
            revert PolicyViolation(VIOLATION_SIGNER | preview(to, value, data));
        }
        _enforcePolicy(to, value, data);
        unchecked {
            ++nonce;
            ++calls;
        }
        spent += value;
        return _call(to, value, data, signer);
    }

    // -------------------------------------------------------------------------
    // Views — same checks the chain will run. Agent / UI can simulate first.
    // -------------------------------------------------------------------------

    function remaining() public view returns (uint256) {
        if (spent >= maxValue) return 0;
        return maxValue - spent;
    }

    function allowedTarget(
        address to
    ) public view returns (bool) {
        return _targets.contains(to);
    }

    function allowedSelector(
        bytes4 selector
    ) public view returns (bool) {
        return _selectors.contains(selector);
    }

    function allowlistedTargets() external view returns (address[] memory) {
        return _targets.values();
    }

    function allowlistedSelectors() external view returns (bytes4[] memory) {
        return _selectors.values();
    }

    function allowedToken(
        address token
    ) public view returns (bool) {
        return _tokens.contains(token);
    }

    function allowlistedTokens() external view returns (address[] memory) {
        return _tokens.values();
    }

    /// @notice Bitmask of every policy check that would fail. 0 = session may execute.
    function preview(
        address to,
        uint256 value,
        bytes calldata data
    ) public view returns (uint256 code) {
        if (!armed || sessionKey == address(0)) code |= VIOLATION_NOT_ARMED;
        if (block.timestamp > expiry) code |= VIOLATION_EXPIRED;
        if (!_targets.contains(to)) code |= VIOLATION_TARGET;
        if (value > remaining()) code |= VIOLATION_VALUE;
        if (maxPerCall != 0 && value > maxPerCall) code |= VIOLATION_PER_CALL;
        if (maxCalls != 0 && calls >= maxCalls) code |= VIOLATION_CALLS;
        if (!_selectors.contains(_selector(data))) code |= VIOLATION_SELECTOR;
        if (_tokens.length() != 0) {
            (address token, bool isSwap) = _swapToken(data);
            if (isSwap && !_tokens.contains(token)) code |= VIOLATION_TOKEN;
        }
    }

    /// @notice Digest the session key must sign (EIP-712). Used by tests and relayers.
    function hashExecute(
        address to,
        uint256 value,
        bytes calldata data
    ) public view returns (bytes32) {
        return _hashTypedDataV4(
            keccak256(abi.encode(EXECUTE_TYPEHASH, to, value, keccak256(data), nonce))
        );
    }

    function DOMAIN_SEPARATOR() external view returns (bytes32) {
        return _domainSeparatorV4();
    }

    // -------------------------------------------------------------------------
    // Internals
    // -------------------------------------------------------------------------

    function _setAgentEns(
        string memory agentEns_
    ) internal {
        agentEns = agentEns_;
        emit AgentNamed(agentEns_);
    }

    function _enforcePolicy(
        address to,
        uint256 value,
        bytes calldata data
    ) internal view {
        uint256 code = preview(to, value, data);
        if (code != 0) revert PolicyViolation(code);
    }

    /// @dev Low-level call on purpose. OZ `Address.functionCallWithValue` reverts on EOAs
    ///      (`AddressEmptyCode`), but the owner must still be able to send ETH to 0xdEaD.
    function _call(
        address to,
        uint256 value,
        bytes calldata data,
        address signer
    ) internal returns (bytes memory) {
        (bool ok, bytes memory ret) = to.call{value: value}(data);
        if (!ok) {
            assembly ("memory-safe") {
                revert(add(ret, 0x20), mload(ret))
            }
        }
        emit Executed(signer, to, value, _selector(data));
        return ret;
    }

    function _selector(
        bytes calldata data
    ) internal pure returns (bytes4) {
        if (data.length < 4) return bytes4(0);
        return bytes4(data[0:4]);
    }

    function _swapToken(
        bytes calldata data
    ) internal pure returns (address token, bool isSwap) {
        if (data.length < 36) return (address(0), false);
        if (_selector(data) != SWAP_SELECTOR) return (address(0), false);
        token = abi.decode(data[4:], (address));
        return (token, true);
    }
}
