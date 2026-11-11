import { keccak256, stringToHex } from "viem";
export const canonical = (x) =>
  Array.isArray(x)
    ? x.map(canonical)
    : x && typeof x === "object"
      ? Object.fromEntries(
          Object.keys(x)
            .sort()
            .map((k) => [k, canonical(x[k])]),
        )
      : x;
export const abiHash = (abi) =>
  keccak256(stringToHex(JSON.stringify(canonical(abi)))).slice(2);
