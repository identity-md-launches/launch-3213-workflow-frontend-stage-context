// SPDX-License-Identifier: MIT
pragma solidity 0.8.26;
/// @dev Local fork fixture: only the metadata read by PriceGuard.checkVenue is exercised.
contract ForkVenue {
 address public immutable factory;
 address public immutable WETH9;
 constructor(address f,address w){factory=f;WETH9=w;}
}
