import { readFileSync } from "node:fs";
import {
  decodeFunctionData,
  encodeFunctionResult,
  encodeErrorResult,
  encodeAbiParameters,
  keccak256,
  stringToHex,
  getCreate2Address,
  toHex,
  zeroAddress,
} from "viem";
import {
  erc20Abi,
  stateViewAbi,
  quoterAbi,
  permit2Abi,
  routerAbi,
  oftAbi,
  factoryAbi,
} from "../src/config.ts";
const handoff = JSON.parse(
  readFileSync(new URL("../deployment/handoff.json", import.meta.url)),
);
const abis = {};
for (const name of [
  "LaunchToken",
  "LpDesk",
  "FirmVault",
  "GenesisSplitter",
  "Burner",
  "LpGovernor",
  "PriceGuard",
  "VenueV3",
  "VenueV4",
])
  abis[name] = JSON.parse(
    readFileSync(new URL(`../public/abi/${name}.json`, import.meta.url)),
  );
export const addr = Object.fromEntries(
  handoff.contracts.map((c) => [c.name, c.address]),
);
const hashes = {
  LpGovernor:
    "0x0fc46e72ec8b2bcdf990b19aa94fa75b36772ba3760f759310a8c124896bec92",
  PriceGuard:
    "0xd7cbfc1e3a02e71d5d069f3a6c86379cfc5e71fb9f944dc09fa25266b28f606d",
  VenueV3: "0x4728bed9169bb2058437c604cd5cc8ba12f224b15b162b6aed33e0b5f0569aa6",
  VenueV4: "0xf3b9ae535cff2be3df93543e093219876fd10175986b1e50e5b56c3179f569e6",
};
for (const [name, bytecodeHash] of Object.entries(hashes))
  addr[name] = getCreate2Address({
    from: addr.LpDesk,
    salt: stringToHex(name, { size: 32 }),
    bytecodeHash,
  });
addr.Burner = JSON.parse(
  readFileSync(new URL("../../docs/frontend/live-read.json", import.meta.url)),
).burner;
export const operator = handoff.manifest.contracts.find(
  (c) => c.contract === "LpDesk",
).constructorArgs[1];
export const visitor = handoff.manifest.contracts.find(
  (c) => c.contract === "LpDesk",
).constructorArgs[2];
export const imd = handoff.manifest.pool.pairedCurrency,
  weth = "0x4200000000000000000000000000000000000006";
const unit = 10n ** 18n,
  Q96 = 1n << 96n,
  dead = "0x000000000000000000000000000000000000dead";
const hash = keccak256(stringToHex("isolated-browser-fixture"));
export function createMock() {
  const state = {
    time: 1800000000n,
    block: 60000000n,
    chain: handoff.chainId,
    modules: true,
    registered: true,
    boot: true,
    extraVenue: false,
    badAsset: false,
    reject: false,
    failSimulation: false,
    ercAllowance: 0n,
    permitAllowance: 0n,
    stakeAllowance: 0n,
    sent: [],
    calls: [],
    balance: 1000n * unit,
    burner: 50n * unit,
    burned: 100000n * unit,
    proposed: 0,
  };
  const venues = () => [
    {
      manager: "0x7c5f5a4bbd8fd63184577525326123b519429bdc",
      kind: 0,
      factory: "0x498581ff718922c3f8e6a244956af099b2652b2b",
    },
    {
      manager: "0x03a520b32c04bf3beef7beb72e919cf822ed34f1",
      kind: 1,
      factory: "0x33128a8fc17869897dce68ed026d694621f6fdfd",
    },
    ...(state.extraVenue
      ? [{ manager: addr.LpGovernor, kind: 1, factory: addr.PriceGuard }]
      : []),
  ];
  const positions = [
    {
      manager: venues()[0].manager,
      kind: 0,
      asset: imd,
      fee: 3000,
      tickSpacing: 60,
      tickLower: -60,
      tickUpper: 60,
      tokenId: 123n,
      open: true,
    },
    {
      manager: venues()[1].manager,
      kind: 1,
      asset: weth,
      fee: 3000,
      tickSpacing: 60,
      tickLower: -60,
      tickUpper: 60,
      tokenId: 124n,
      open: true,
    },
  ];
  function proposal(id) {
    const kind = id === 1 ? 4 : id === 2 ? 1 : 2;
    const end = state.time + (id === 0 ? 3600n : id === 3 ? -3600n : -400000n),
      veto = id === 3 ? state.time + 3600n : state.time - 100n,
      expiry = id === 2 ? state.time - 10n : state.time + 86400n;
    const data =
      kind === 4
        ? encodeAbiParameters(
            [{ type: "uint256" }, { type: "uint256" }],
            [0n, unit],
          )
        : kind === 1
          ? encodeAbiParameters([{ type: "address" }], [weth])
          : encodeAbiParameters(
              [{ type: "address" }, { type: "uint8" }],
              [addr.VenueV3, 1],
            );
    return {
      kind,
      author: visitor,
      byOperator: false,
      executed: false,
      vetoed: false,
      checkpointBlock: state.block - 1n,
      voteEnd: end,
      vetoEnd: veto,
      expiry,
      quorumBase: 1000000n * unit,
      forWeight: 40000n * unit,
      againstWeight: 1000n * unit,
      data,
    };
  }
  const all = [
    ...Object.values(abis),
    erc20Abi,
    stateViewAbi,
    quoterAbi,
    permit2Abi,
    routerAbi,
    oftAbi,
    factoryAbi,
  ];
  const decode = (data) => {
    for (const abi of all) {
      try {
        return { ...decodeFunctionData({ abi, data }), abi };
      } catch {}
    }
    throw Error("Unknown call " + data.slice(0, 10));
  };
  const block = (n) => ({
    number: toHex(n),
    timestamp: toHex(state.time - (state.block - n) * 2n),
    hash,
    parentHash: hash,
    nonce: "0x0000000000000000",
    sha3Uncles: hash,
    logsBloom: "0x" + "00".repeat(256),
    transactionsRoot: hash,
    stateRoot: hash,
    receiptsRoot: hash,
    miner: visitor,
    difficulty: "0x0",
    totalDifficulty: "0x0",
    extraData: "0x",
    size: "0x100",
    gasLimit: "0x1c9c380",
    gasUsed: "0x5208",
    baseFeePerGas: "0x1",
    transactions: [],
    uncles: [],
    mixHash: hash,
    withdrawalsRoot: hash,
  });
  function handle(req) {
    try {
      const { method, params = [] } = req;
      let result;
      if (method === "eth_chainId") result = toHex(state.chain);
      else if (method === "eth_blockNumber") result = toHex(state.block);
      else if (method === "eth_getBlockByNumber")
        result = block(
          params[0] === "latest" ? state.block : BigInt(params[0]),
        );
      else if (method === "eth_getBlockByHash") result = block(state.block);
      else if (method === "eth_getCode")
        result =
          !state.modules &&
          Object.entries(addr).some(
            ([k, a]) =>
              Object.keys(hashes).includes(k) &&
              a.toLowerCase() === params[0].toLowerCase(),
          )
            ? "0x"
            : "0x60006000";
      else if (
        method === "eth_getLogs" ||
        method === "wallet_requestPermissions" ||
        method === "wallet_revokePermissions"
      )
        result = [];
      else if (method === "eth_getBalance") result = toHex(unit);
      else if (method === "eth_estimateGas") result = "0x50000";
      else if (
        method === "eth_gasPrice" ||
        method === "eth_maxPriorityFeePerGas"
      )
        result = "0x1";
      else if (method === "eth_getTransactionCount") result = "0x1";
      else if (method === "eth_getTransactionReceipt")
        result = {
          transactionHash: params[0],
          transactionIndex: "0x0",
          blockHash: hash,
          blockNumber: toHex(state.block),
          from: visitor,
          to: addr.LpDesk,
          cumulativeGasUsed: "0x5208",
          gasUsed: "0x5208",
          contractAddress: null,
          logs: [],
          logsBloom: "0x" + "00".repeat(256),
          status: "0x1",
          effectiveGasPrice: "0x1",
          type: "0x2",
        };
      else if (method === "eth_sendTransaction") {
        const tx = params[0],
          d = decode(tx.data);
        state.sent.push({ to: tx.to, ...d, args: d.args });
        if (d.functionName === "approve") {
          if (tx.to.toLowerCase() === networkPermit.toLowerCase())
            state.permitAllowance = d.args[2];
          else if (d.args[0].toLowerCase() === addr.LpGovernor.toLowerCase())
            state.stakeAllowance = d.args[1];
          else state.ercAllowance = d.args[1];
        }
        if (
          d.functionName === "burn" &&
          tx.to.toLowerCase() === addr.Burner.toLowerCase()
        ) {
          state.burned += state.burner;
          state.burner = 0n;
        }
        result = hash;
      } else if (method === "eth_call") {
        const tx = params[0],
          d = decode(tx.data),
          fn = d.functionName,
          args = d.args ?? [];
        state.calls.push({ to: tx.to, fn, args });
        let value;
        const moduleName = Object.entries(addr).find(
          ([, a]) => a.toLowerCase() === tx.to.toLowerCase(),
        )?.[0];
        if (fn === "balanceOf") {
          const who = args[0].toLowerCase();
          value =
            who === dead
              ? state.burned
              : who === addr.Burner.toLowerCase()
                ? state.burner
                : who === addr.GenesisSplitter.toLowerCase()
                  ? 0n
                  : who === visitor.toLowerCase() ||
                      who === operator.toLowerCase()
                    ? state.balance
                    : 10000n * unit;
        } else if (fn === "decimals") value = 18;
        else if (fn === "symbol")
          value = tx.to.toLowerCase() === weth ? "WETH" : "IMD";
        else if (fn === "allowance")
          value =
            moduleName === undefined &&
            tx.to.toLowerCase() === networkPermit.toLowerCase()
              ? [state.permitAllowance, Number(state.time + 3600n), 0]
              : args.length === 3
                ? [state.permitAllowance, Number(state.time + 3600n), 0]
                : args[1].toLowerCase() === addr.LpGovernor.toLowerCase()
                  ? state.stakeAllowance
                  : state.ercAllowance;
        else if (fn === "operator") value = operator;
        else if (fn === "projectWallet") value = visitor;
        else if (fn === "DEAD") value = dead;
        else if (fn === "launchFactory") value = visitor;
        else if (fn === "token" || fn === "notstock") value = addr.LaunchToken;
        else if (
          ["burner", "lpGovernor", "priceGuard", "venueV3", "venueV4"].includes(
            fn,
          )
        )
          value =
            addr[
              {
                burner: "Burner",
                lpGovernor: "LpGovernor",
                priceGuard: "PriceGuard",
                venueV3: "VenueV3",
                venueV4: "VenueV4",
              }[fn]
            ];
        else if (fn === "launchNumber") value = 3206n;
        else if (fn === "registered") value = state.registered;
        else if (fn === "bootstrapEnd")
          value = state.boot ? state.time + 86400n : state.time - 1n;
        else if (fn === "buybackBucket") value = 200n * unit;
        else if (fn === "undistributed") value = 100n * unit;
        else if (fn === "hasSplit") value = true;
        else if (fn === "venues") value = venues();
        else if (fn === "assets")
          value = [
            imd,
            weth,
            ...(state.badAsset
              ? ["0xb2000000000000000000002D0BA3164cc74f58B7"]
              : []),
          ];
        else if (fn === "totalStaked") value = 1000000n * unit;
        else if (fn === "staked" || fn === "stakedAt") value = 1000n * unit;
        else if (fn === "proposalCount") value = 4n;
        else if (fn === "bridges")
          value = [
            {
              adapter: addr.VenueV4,
              dstChainId: 30101,
              dstLpDesk: addr.LpDesk,
            },
          ];
        else if (fn === "freeBalance") {
          if (
            state.badAsset &&
            args[0].toLowerCase() ===
              "0xb2000000000000000000002d0ba3164cc74f58b7"
          )
            return {
              jsonrpc: "2.0",
              id: req.id,
              error: { code: 3, message: "execution reverted", data: "0x" },
            };
          value = 100000n * unit;
        } else if (fn === "topUpBasket" || fn === "buybackBasket")
          value = 200n * unit;
        else if (fn === "positions") value = positions;
        else if (fn === "positionLiquidity" || fn === "liquidityOf")
          value = 100000n * unit;
        else if (fn === "proposal") value = proposal(Number(args[0]));
        else if (fn === "state") value = [0, 3, 4, 2][Number(args[0])];
        else if (fn === "hasVoted") value = false;
        else if (fn === "getSlot0") value = [Q96, 0, 0, 12500];
        else if (fn === "prepare") value = args[0];
        else if (fn === "poolPrice") value = [Q96, true];
        else if (fn === "quote")
          value = args[3]
            ? [0n, args[2], args[2] * 100n]
            : [args[2], args[2] / 2n, args[2] * 100n];
        else if (fn === "quoteSend")
          value = { nativeFee: 1000000000000000n, lzTokenFee: 0n };
        else if (fn === "quoteExactInputSingle")
          value = [args[0].exactAmount * 2n, 120000n];
        else if (fn === "buyback") {
          const n = args.length === 3 ? args[1] : args[0],
            min = args.at(-1);
          if (min > n * 2n)
            return {
              jsonrpc: "2.0",
              id: req.id,
              error: {
                code: 3,
                message: "execution reverted",
                data: encodeErrorResult({
                  abi: abis.VenueV4,
                  errorName: "BelowMinOut",
                }),
              },
            };
          value = undefined;
        } else if (fn === "moduleCodeHash")
          value =
            hashes[
              new TextDecoder()
                .decode(Buffer.from(args[0].slice(2), "hex"))
                .replace(/\0/g, "")
            ];
        else {
          if (state.failSimulation)
            return {
              jsonrpc: "2.0",
              id: req.id,
              error: {
                code: 3,
                message: "execution reverted",
                data: encodeErrorResult({
                  abi: abis.LpDesk,
                  errorName: "PriceMoved",
                }),
              },
            };
          const f = d.abi.find((i) => i.type === "function" && i.name === fn);
          value =
            f.outputs.length === 0
              ? undefined
              : f.outputs[0].type === "bool"
                ? true
                : 0n;
        }
        result = encodeFunctionResult({
          abi: d.abi,
          functionName: fn,
          result: value,
        });
      } else throw Error("Unhandled RPC method: " + method);
      return { jsonrpc: "2.0", id: req.id, result };
    } catch (e) {
      console.error("mock:", req.method, e.message);
      return {
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32603, message: e.message },
      };
    }
  }
  const networkPermit = "0x000000000022d473030f116ddee9f6b43ac78ba3";
  return { state, handle };
}
