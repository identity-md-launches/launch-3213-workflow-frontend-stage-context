import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  decodeAbiParameters,
  parseAbiParameters,
  zeroAddress,
  type Address,
} from "viem";
import {
  amount,
  units,
  checkedAmount,
  rangeTicks,
  sqrtAtTick,
  sqrtFromPrice,
  priceFromSqrt,
  Q96,
  minimum,
  slippage,
  bootstrapActive,
  canPropose,
  liquidityAmounts,
} from "../src/math";
import { encodeSwap } from "../src/swap";
import { switchNetwork } from "../src/wallet";
import { hashAbi, type Runtime } from "../src/config";
import { errorText } from "../src/errors";
const handoff = JSON.parse(
  readFileSync(new URL("../deployment/handoff.json", import.meta.url), "utf8"),
);
const network = JSON.parse(
  readFileSync(new URL("../deployment/network.json", import.meta.url), "utf8"),
);
const r = { deployment: { ...handoff, ...network } } as Runtime;
test("attested ABIs match canonical Keccak for every handed-off contract", () => {
  for (const c of handoff.contracts) {
    const abi = JSON.parse(
      readFileSync(
        new URL(`../public/abi/${c.name}.json`, import.meta.url),
        "utf8",
      ),
    );
    assert.equal(hashAbi(abi), c.abiHash);
  }
});
test("amount validation blocks precision loss, negatives and amounts over available balance", () => {
  assert.equal(amount("1.000001", 6), 1000001n);
  for (const text of ["1.0000001", "-1", "1e3", "NaN", "0", ""])
    assert.throws(() => amount(text, 6));
  assert.throws(
    () => checkedAmount("2", 18, 10n ** 18n, "NOTSTOCK"),
    /exceeds/,
  );
  assert.equal(checkedAmount("1", 18, 10n ** 18n, "NOTSTOCK"), 10n ** 18n);
});
test("bootstrap boundaries and governance thresholds use exact integer comparisons", () => {
  assert.equal(bootstrapActive(100n, 99n), true);
  assert.equal(bootstrapActive(100n, 100n), false);
  assert.equal(bootstrapActive(0n, 0n), false);
  assert.equal(canPropose(0n, 0n, false), false);
  assert.equal(canPropose(999n, 1000000n, false), false);
  assert.equal(canPropose(1000n, 1000000n, false), true);
  assert.equal(canPropose(0n, 0n, true), true);
});
test("range conversions respect token sorting, mixed decimals and tick spacing", () => {
  for (const order of [true, false])
    for (const decimals of [6, 8, 18]) {
      const sqrt = sqrtFromPrice("2.5", order, decimals);
      assert(Math.abs(priceFromSqrt(sqrt, order, decimals) - 2.5) < 1e-10);
      const [lower, upper] = rangeTicks("1", "4", order, decimals, 60);
      assert.equal(lower % 60 === 0, true);
      assert.equal(upper % 60 === 0, true);
      assert(lower < upper);
    }
  assert.throws(() => rangeTicks("4", "1", true, 18, 60));
  assert.equal(sqrtAtTick(0), Q96);
  assert.equal(sqrtAtTick(-887272), 4295128739n);
  assert.equal(
    sqrtAtTick(887272),
    1461446703485210103287273052203988822378723970342n,
  );
  const [a, b] = liquidityAmounts(Q96, -60, 60, 1000000n);
  assert(a > 0n && b > 0n);
});
test("swap encodes exact handoff pool key, correct direction, settlement and take", () => {
  const key = handoff.poolKey;
  for (const input of [key.currency0, key.currency1])
    for (const extended of [false, true]) {
      const result = encodeSwap(key, input, 123n, 100n, extended);
      const [actions, params] = decodeAbiParameters(
        [{ type: "bytes" }, { type: "bytes[]" }],
        result,
      );
      assert.equal(actions, "0x060c0f");
      const tuple = `((address currency0,address currency1,uint24 fee,int24 tickSpacing,address hooks) poolKey,bool zeroForOne,uint128 amountIn,uint128 amountOutMinimum,${extended ? "uint256 minHopPriceX36," : ""}bytes hookData)`;
      const [swap] = decodeAbiParameters(
        parseAbiParameters(tuple),
        params[0],
      ) as any;
      assert.equal(swap.poolKey.hooks.toLowerCase(), key.hooks);
      assert.equal(swap.zeroForOne, input === key.currency0);
      assert.equal(swap.amountIn, 123n);
      assert.equal(swap.amountOutMinimum, 100n);
      const [settle, n] = decodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        params[1],
      );
      assert.equal(settle.toLowerCase(), input);
      assert.equal(n, 123n);
      const [take, m] = decodeAbiParameters(
        [{ type: "address" }, { type: "uint256" }],
        params[2],
      );
      assert.equal(
        take.toLowerCase(),
        input === key.currency0 ? key.currency1 : key.currency0,
      );
      assert.equal(m, 100n);
    }
});
test("slippage cannot become NaN or introduce float rounding in minimum outputs", () => {
  assert.equal(minimum(100000n, slippage("0.5")), 99500n);
  assert.throws(() => slippage("-1"));
  assert.throws(() => slippage("51"));
  assert.throws(() => slippage("NaN"));
});
test("missing chain follows switch, exact add-chain payload, switch again", async () => {
  const calls: any[] = [];
  await switchNetwork(
    {
      request: async (args) => {
        calls.push(args);
        if (calls.length === 1) throw { code: 4902 };
      },
    },
    r,
  );
  assert.deepEqual(
    calls.map((c) => c.method),
    [
      "wallet_switchEthereumChain",
      "wallet_addEthereumChain",
      "wallet_switchEthereumChain",
    ],
  );
  assert.deepEqual(calls[1].params, [network.walletAddChain]);
});
test("wallet rejection never triggers add-chain and readable contract errors have recovery advice", async () => {
  const calls: any[] = [];
  await assert.rejects(
    switchNetwork(
      {
        request: async (args) => {
          calls.push(args);
          throw { code: 4001 };
        },
      },
      r,
    ),
  );
  assert.equal(calls.length, 1);
  assert.match(errorText({ code: 4001 }), /rejected/);
  assert.match(errorText({ data: { errorName: "PriceMoved" } }), /Refresh/);
});

test("display formatting preserves large integers and distinguishes dust from zero", () => {
  assert.equal(
    units(999999999999999999n * 10n ** 18n),
    "999,999,999,999,999,999",
  );
  assert.equal(units(1n), "<0.0001");
  assert.equal(units(0n), "0");
  assert.equal(units(undefined), "Unavailable");
  assert.throws(
    () => checkedAmount("1", 18, undefined, "asset"),
    /unavailable/,
  );
});
