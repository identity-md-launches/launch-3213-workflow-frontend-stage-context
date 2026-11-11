import { useState } from "react";
import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { encodeAbiParameters, zeroAddress, type Address, type Hex } from "viem";
import {
  contract,
  erc20Abi,
  permit2Abi,
  quoterAbi,
  routerAbi,
  same,
  type PoolKey,
  type Runtime,
} from "./config";
import { amount, checkedAmount, exact, minimum, slippage, units } from "./math";
import { Field, Select, TxButton, WalletGate } from "./ui";
import type { Snapshot } from "./types";
import { errorText } from "./errors";
const poolComponents = [
  { name: "currency0", type: "address" },
  { name: "currency1", type: "address" },
  { name: "fee", type: "uint24" },
  { name: "tickSpacing", type: "int24" },
  { name: "hooks", type: "address" },
] as const;
export function encodeSwap(
  key: PoolKey,
  input: Address,
  n: bigint,
  min: bigint,
  extended = false,
) {
  const zeroForOne = same(key.currency0, input);
  const output = zeroForOne ? key.currency1 : key.currency0;
  const fields = [
    { name: "poolKey", type: "tuple", components: poolComponents },
    { name: "zeroForOne", type: "bool" },
    { name: "amountIn", type: "uint128" },
    { name: "amountOutMinimum", type: "uint128" },
    ...(extended ? [{ name: "minHopPriceX36", type: "uint256" }] : []),
    { name: "hookData", type: "bytes" },
  ];
  const swap = encodeAbiParameters(
    [{ type: "tuple", components: fields }],
    [
      {
        poolKey: key,
        zeroForOne,
        amountIn: n,
        amountOutMinimum: min,
        ...(extended ? { minHopPriceX36: 0n } : {}),
        hookData: "0x",
      },
    ],
  );
  const settle = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [input, n],
  );
  const take = encodeAbiParameters(
    [{ type: "address" }, { type: "uint256" }],
    [output, min],
  );
  return encodeAbiParameters(
    [{ type: "bytes" }, { type: "bytes[]" }],
    ["0x060c0f", [swap, settle, take]],
  );
}
export async function quoteSwap(
  r: Runtime,
  input: Address,
  n: bigint,
  account?: Address,
) {
  if (n >= 1n << 128n) throw Error("Amount is too large for this pool.");
  const result = await r.client.simulateContract({
    address: r.deployment.network.uniswapV4.quoter,
    abi: quoterAbi,
    functionName: "quoteExactInputSingle",
    args: [
      {
        poolKey: r.deployment.poolKey,
        zeroForOne: same(input, r.deployment.poolKey.currency0),
        exactAmount: n,
        hookData: "0x",
      },
    ],
    account,
  });
  return { out: result.result[0], at: Date.now() };
}
export function Swap({
  r,
  s,
  reload,
}: {
  r: Runtime;
  s?: Snapshot;
  reload: () => Promise<unknown>;
}) {
  const { address } = useAccount();
  const [direction, setDirection] = useState("buy"),
    [value, setValue] = useState(""),
    [slip, setSlip] = useState("0.5");
  const not = contract(r, "LaunchToken"),
    imd = r.deployment.network.pairToken;
  const buy = direction === "buy";
  const input = buy ? imd.address : not,
    output = buy ? not : imd.address,
    inputSymbol = buy ? imd.symbol : "NOTSTOCK",
    outSymbol = buy ? "NOTSTOCK" : imd.symbol,
    decimals = buy ? imd.decimals : 18,
    outDecimals = buy ? 18 : imd.decimals;
  let n: bigint | undefined;
  let inputError = "";
  try {
    if (value) n = amount(value, decimals);
  } catch (e) {
    inputError = errorText(e);
  }
  const protocols = r.deployment.network.uniswapV4;
  const native = same(input, zeroAddress);
  const quote = useQuery({
    queryKey: ["quote", input, n?.toString(), address],
    queryFn: () => quoteSwap(r, input, n!, address),
    enabled: !!n,
    staleTime: 15000,
    retry: false,
  });
  const allowances = useQuery({
    queryKey: ["swap-allowance", address, input, s?.block.toString()],
    enabled: !!address && !native,
    queryFn: async () => {
      const [erc, permit] = await Promise.all([
        r.client.readContract({
          address: input,
          abi: erc20Abi,
          functionName: "allowance",
          args: [address!, protocols.permit2],
        }),
        r.client.readContract({
          address: protocols.permit2,
          abi: permit2Abi,
          functionName: "allowance",
          args: [address!, input, protocols.universalRouter],
        }),
      ]);
      return { erc, permit };
    },
    retry: false,
  });
  const balance = buy ? s?.walletImd : s?.walletBalance;
  const needsErc =
    !native && !!n && !!allowances.data && allowances.data.erc < n;
  const needsPermit =
    !native &&
    !!n &&
    !!allowances.data &&
    (allowances.data.permit[0] < n ||
      allowances.data.permit[1] <= Number(s?.time ?? 0n) + 60);
  const above = !!n && balance !== undefined && n > balance;
  let min = 0n;
  try {
    if (quote.data) min = minimum(quote.data.out, slippage(slip));
  } catch {
    inputError = "Set slippage between 0 and 50%.";
  }
  const ready =
    !!n &&
    !inputError &&
    !above &&
    !!quote.data &&
    (!address || native || !!allowances.data);
  async function refresh() {
    await reload();
    await allowances.refetch();
    await quote.refetch();
  }
  return (
    <div className="trade-form">
      <div className="trade-heading">
        <h2>Trade NOTSTOCK</h2>
        <span className="pill">IMD pair</span>
      </div>
      <div className="trade-tabs" role="group" aria-label="Trade direction">
        <button
          aria-pressed={buy}
          onClick={() => {
            setDirection("buy");
            setValue("");
          }}
        >
          Buy
        </button>
        <button
          aria-pressed={!buy}
          onClick={() => {
            setDirection("sell");
            setValue("");
          }}
        >
          Sell
        </button>
      </div>
      <div className="amount-head">
        <label htmlFor="swap-amount">You pay · {inputSymbol}</label>
        <button
          className="text-button"
          disabled={balance === undefined}
          onClick={() => setValue(exact(balance!, decimals))}
        >
          Max
        </button>
      </div>
      <input
        className="trade-input"
        id="swap-amount"
        inputMode="decimal"
        placeholder="0.00"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        aria-invalid={above || !!inputError}
        aria-describedby="swap-help"
      />
      <small id="swap-help">
        {address
          ? `Balance: ${units(balance, decimals)} ${inputSymbol}`
          : "Connect to view your balance."}
      </small>
      <div className="receive">
        <span>You receive · {outSymbol}</span>
        <strong>
          {quote.isFetching
            ? "Quoting…"
            : quote.data
              ? units(quote.data.out, outDecimals, 6)
              : "—"}
        </strong>
      </div>
      <div className="trade-options">
        <Select label="Slippage" value={slip} onChange={setSlip}>
          <option value="0.1">0.1%</option>
          <option value="0.5">0.5%</option>
          <option value="1">1%</option>
          <option value="3">3%</option>
        </Select>
        <div>
          <small>Minimum received</small>
          <p>
            {quote.data ? `${units(min, outDecimals, 6)} ${outSymbol}` : "—"}
          </p>
        </div>
      </div>
      {(inputError || above) && (
        <p role="alert" className="error">
          {above
            ? `This amount exceeds your ${inputSymbol} balance. Use Max or enter a smaller amount.`
            : inputError}
        </p>
      )}
      {quote.error && (
        <p className="error" role="alert">
          Unable to quote this trade. The pool may have no liquidity.{" "}
          <button className="text-button" onClick={() => quote.refetch()}>
            Retry quote
          </button>
        </p>
      )}
      {allowances.error && (
        <p className="error">
          Unable to read allowances.{" "}
          <button className="text-button" onClick={() => allowances.refetch()}>
            Retry allowances
          </button>
        </p>
      )}
      {needsErc ? (
        <TxButton
          r={r}
          s={s}
          reload={refresh}
          label={`Approve ${inputSymbol}`}
          className="primary wide"
          disabled={!ready}
          prepare={async () => {
            const fresh = await r.client.readContract({
              address: input,
              abi: erc20Abi,
              functionName: "allowance",
              args: [address!, protocols.permit2],
            });
            if (fresh >= n!)
              throw Error("Token is already approved. Refresh the allowance.");
            return {
              address: input,
              abi: erc20Abi,
              functionName: "approve",
              args: [
                protocols.permit2,
                checkedAmount(value, decimals, balance!, inputSymbol),
              ],
              summary: `Approve exactly ${value} ${inputSymbol} to Permit2. A separate router permission follows.`,
            };
          }}
        />
      ) : needsPermit ? (
        <TxButton
          r={r}
          s={s}
          reload={refresh}
          label="Allow router in Permit2"
          className="primary wide"
          disabled={!ready}
          prepare={() => ({
            address: protocols.permit2,
            abi: permit2Abi,
            functionName: "approve",
            args: [
              input,
              protocols.universalRouter,
              n!,
              Number(s!.time) + 1800,
            ],
            summary: `Allow the configured Universal Router to spend exactly ${value} ${inputSymbol} through Permit2 for 30 minutes.`,
          })}
        />
      ) : (
        <TxButton
          r={r}
          s={s}
          reload={refresh}
          label={buy ? "Buy NOTSTOCK" : "Sell NOTSTOCK"}
          className="primary wide"
          disabled={!ready || !quote.data?.out}
          prepare={async () => {
            const inputAmount = checkedAmount(
              value,
              decimals,
              balance!,
              inputSymbol,
            );
            if (!quote.data || Date.now() - quote.data.at > 30000) {
              await quote.refetch();
              throw Error(
                "The quote expired. Review the refreshed quote and try again.",
              );
            }
            const fresh = await quoteSwap(r, input, inputAmount, address);
            const minimumOut = minimum(quote.data.out, slippage(slip));
            if (fresh.out < minimumOut)
              throw Error(
                "Price moved beyond your slippage. Refresh the quote and try again.",
              );
            const encoded = encodeSwap(
              r.deployment.poolKey,
              input,
              inputAmount,
              minimumOut,
              protocols.extendedSwapParams,
            );
            return {
              address: protocols.universalRouter,
              abi: routerAbi,
              functionName: "execute",
              args: ["0x10" as Hex, [encoded], s!.time + 600n],
              value: native ? inputAmount : 0n,
              summary: `Spend ${value} ${inputSymbol} for at least ${exact(minimumOut, outDecimals)} ${outSymbol}. Slippage: ${slip}%. Deadline: 10 minutes.`,
            };
          }}
        />
      )}
      <small className="trade-foot">
        Pool fee 1.25%. Network fees apply. USD pricing unavailable.
      </small>
    </div>
  );
}
