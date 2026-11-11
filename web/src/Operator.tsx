import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { Abi, Address } from "viem";
import { contract, same, venueLabel } from "./config";
import type { PageProps } from "./Home";
import type { PositionView } from "./types";
import {
  bootstrapActive,
  checkedAmount,
  exact,
  minimum,
  priceFromSqrt,
  rangeTicks,
  slippage,
  units,
} from "./math";
import { AddressLink, Empty, Field, Panel, Select, TxButton } from "./ui";
import { PositionEditor } from "./PositionEditor";
import { date, timeLeft, validAddress } from "./Governance";
import { errorText } from "./errors";
// These read-only calls find the exact output bound for a void-returning buyback.
// Every call is pinned to one block. No wallet request or transaction is made.
export async function quoteBuyback(
  props: PageProps,
  address: Address,
  abi: Abi,
  args: readonly unknown[],
  guess: bigint,
) {
  const { r, s } = props;
  if (!s) throw Error("Refresh state before quoting.");
  const blockNumber = await r.client.getBlockNumber();
  const errors = [...r.abis.VenueV3, ...r.abis.VenueV4].filter(
    (i) => i.type === "error",
  );
  const combined = [...abi, ...errors];
  const simulate = async (min: bigint) =>
    r.client.simulateContract({
      address,
      abi: combined,
      functionName: "buyback",
      args: [...args, min],
      account: s.operator,
      blockNumber,
    });
  await simulate(0n);
  let lo = 0n,
    hi = guess > 0n ? guess * 2n : 10n ** 18n;
  async function accepts(n: bigint) {
    try {
      await simulate(n);
      return true;
    } catch (e) {
      if (/BelowMinOut|BelowMinimum/.test((e as Error).message)) return false;
      throw e;
    }
  }
  let bounded = false;
  for (let i = 0; i < 20; i++) {
    if (!(await accepts(hi))) {
      bounded = true;
      break;
    }
    lo = hi;
    hi *= 2n;
  }
  if (!bounded)
    throw Error("Unable to bound the buyback output. Try a smaller amount.");
  for (let i = 0; i < 64 && hi - lo > 1n; i++) {
    const mid = (lo + hi) / 2n;
    if (await accepts(mid)) lo = mid;
    else hi = mid;
  }
  if (lo === 0n)
    throw Error("This buyback returns no NOTSTOCK. Use a different amount.");
  return { out: lo, block: blockNumber, at: Date.now() };
}
export function Operator({ r, s, reload }: PageProps) {
  const [burn, setBurn] = useState(""),
    [next, setNext] = useState("");
  if (!s) return null;
  const free = s.tokens.find((t) =>
    same(t.address, contract(r, "LaunchToken")),
  )!.free!;
  const boot = bootstrapActive(s.bootstrapEnd, s.time);
  return (
    <>
      <Panel
        title="Operator desk"
        aside={<span className="pill">Operator connected</span>}
      >
        <p>
          Bootstrap{" "}
          {boot
            ? `ends ${date(s.bootstrapEnd)} · ${timeLeft(s.bootstrapEnd, s.time)}`
            : s.bootstrapEnd
              ? `ended ${date(s.bootstrapEnd)}`
              : "starts after registration"}
          . Existing positions can be managed and closed at any time.
        </p>
        <details open={boot}>
          <summary>Open a position</summary>
          <PositionEditor r={r} s={s} reload={reload} />
        </details>
      </Panel>
      <VaultBuyback r={r} s={s} reload={reload} />
      <Panel title="Burn free NOTSTOCK">
        <div className="amount-head">
          <span>Desk free: {units(free)} NOTSTOCK</span>
          <button onClick={() => setBurn(exact(free))}>Max</button>
        </div>
        <Field
          label="NOTSTOCK to burn from desk"
          value={burn}
          onChange={setBurn}
          inputMode="decimal"
        />
        <TxButton
          r={r}
          s={s}
          reload={reload}
          operator
          label="Burn from desk"
          disabled={!burn}
          prepare={() => ({
            address: contract(r, "LpDesk"),
            abi: r.abis.LpDesk,
            functionName: "burn",
            args: [checkedAmount(burn, 18, free, "desk free NOTSTOCK")],
            summary: `Permanently send ${burn} free NOTSTOCK from LpDesk to the dead address. Staked tokens and tokens in positions are excluded.`,
          })}
        />
      </Panel>
      <Panel title="Transfer operator role">
        <p>
          The next operator can manage desk positions and buybacks. Check the
          address before signing.
        </p>
        <Field label="Next operator address" value={next} onChange={setNext} />
        <TxButton
          r={r}
          s={s}
          reload={reload}
          operator
          label="Set operator"
          disabled={!next}
          prepare={() => ({
            address: contract(r, "LpDesk"),
            abi: r.abis.LpDesk,
            functionName: "setOperator",
            args: [validAddress(next)],
            summary: `Transfer the operator role to ${validAddress(next)}. Your wallet loses its operator controls after confirmation.`,
          })}
        />
      </Panel>
    </>
  );
}
export function ManagedPosition({
  p,
  operator,
  ...props
}: { p: PositionView; operator: boolean } & PageProps) {
  const { r, s, reload } = props;
  const [slip, setSlip] = useState("0.5"),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [topup, setTopup] = useState(""),
    [buyback, setBuyback] = useState(""),
    [moveTarget, setMoveTarget] = useState(""),
    [moveLiq, setMoveLiq] = useState("");
  const asset = s?.tokens.find((t) => same(t.address, p.position.asset)),
    token = contract(r, "LaunchToken"),
    notIs0 = token.toLowerCase() < p.position.asset.toLowerCase();
  const [min0, min1] = (() => {
    try {
      const b = slippage(slip);
      const [a0, a1] = notIs0
        ? [p.notstock ?? 0n, p.assetAmount ?? 0n]
        : [p.assetAmount ?? 0n, p.notstock ?? 0n];
      return [minimum(a0, b), minimum(a1, b)];
    } catch {
      return [0n, 0n];
    }
  })();
  const validSlip = (() => {
    try {
      slippage(slip);
      return true;
    } catch {
      return false;
    }
  })();
  const mod = p.position.kind === 0 ? "VenueV4" : "VenueV3",
    module = p.position.kind === 0 ? s?.venueV4 : s?.venueV3;
  const top = useQuery({
    queryKey: ["topup", p.id, topup, s?.block.toString()],
    enabled: operator && !!topup && !!p.sqrtPrice && !!asset?.metadataOk,
    retry: false,
    queryFn: async () => {
      const n = checkedAmount(
        topup,
        asset!.decimals,
        asset!.topUp,
        `${asset!.symbol} top-up basket`,
      );
      const q = (await r.client.readContract({
        address: module!,
        abi: r.abis[mod],
        functionName: "quote",
        args: [p.position, p.sqrtPrice!, n, true],
      })) as [bigint, bigint, bigint];
      if (q[0] > 0n)
        throw Error(
          "This range needs NOTSTOCK. Top-up supports asset-only liquidity.",
        );
      if (q[2] === 0n || q[1] === 0n)
        throw Error("This range cannot take the top-up.");
      if (q[1] > asset!.topUp)
        throw Error(
          "The rounded amount exceeds the top-up basket. Lower the amount slightly.",
        );
      return { n, used: q[1], liquidity: q[2], min: (q[2] * 9950n) / 10000n };
    },
  });
  const shift = useQuery({
    queryKey: ["shift", p.id, from, to, slip, s?.block.toString()],
    enabled:
      operator &&
      !!from &&
      !!to &&
      !!p.sqrtPrice &&
      !!asset?.metadataOk &&
      validSlip,
    retry: false,
    queryFn: async () => {
      const [lower, upper] = rangeTicks(
        from,
        to,
        notIs0,
        asset!.decimals,
        p.position.tickSpacing,
      );
      const position = { ...p.position, tickLower: lower, tickUpper: upper };
      const quote = async (n: bigint, isAsset: boolean) =>
        r.client.readContract({
          address: module!,
          abi: r.abis[mod],
          functionName: "quote",
          args: [position, p.sqrtPrice!, n, isAsset],
        }) as Promise<[bigint, bigint, bigint]>;
      let q = await quote(p.notstock ?? 0n, false);
      if (q[2] === 0n || q[1] > (p.assetAmount ?? 0n))
        q = await quote(p.assetAmount ?? 0n, true);
      if (q[2] === 0n || q[0] > (p.notstock ?? 0n))
        throw Error("The new range cannot fit the withdrawn position amounts.");
      const [a0, a1] = notIs0 ? [q[0], q[1]] : [q[1], q[0]];
      return {
        lower,
        upper,
        dep0: minimum(a0, slippage(slip)),
        dep1: minimum(a1, slippage(slip)),
        not: q[0],
        asset: q[1],
      };
    },
  });
  const buy = useQuery({
    queryKey: ["desk-buyback", p.id, buyback],
    enabled: false,
    retry: false,
    queryFn: async () => {
      const n = checkedAmount(
        buyback,
        asset!.decimals,
        asset!.buyback,
        `${asset!.symbol} buyback basket`,
      );
      const price = priceFromSqrt(p.sqrtPrice!, notIs0, asset!.decimals);
      const guess = BigInt(
        Math.max(
          1,
          Math.floor((Number(exact(n, asset!.decimals)) / price) * 1e18),
        ),
      );
      return quoteBuyback(
        props,
        contract(r, "LpDesk"),
        r.abis.LpDesk,
        [BigInt(p.id), n],
        guess,
      );
    },
  });
  const expected = asset?.metadataOk
    ? `${units(p.notstock)} NOTSTOCK + ${units(p.assetAmount, asset.decimals)} ${asset.symbol}`
    : "Asset valuation unavailable until token metadata and balance can be read.";
  return (
    <article className="position-item">
      <div className="section-head">
        <h3>
          Position #{p.id} · {asset?.symbol ?? p.position.asset}
        </h3>
        <span className="pill">{p.position.open ? "Open" : "Closed"}</span>
      </div>
      <p>
        <AddressLink
          r={r}
          address={p.position.manager}
          label={venueLabel(p.position.manager)}
        />
      </p>
      <dl>
        <div>
          <dt>Range (ticks)</dt>
          <dd>
            {p.position.tickLower} to {p.position.tickUpper}
          </dd>
        </div>
        <div>
          <dt>Token ID / liquidity</dt>
          <dd>
            {p.position.tokenId.toString()} /{" "}
            {p.liquidity?.toString() ?? "Unavailable"}
          </dd>
        </div>
        {p.sqrtPrice && asset?.metadataOk && (
          <div>
            <dt>Current price</dt>
            <dd>
              {priceFromSqrt(p.sqrtPrice, notIs0, asset.decimals).toPrecision(
                8,
              )}{" "}
              {asset.symbol} per NOTSTOCK
            </dd>
          </div>
        )}
        <div>
          <dt>Top-up / buyback baskets</dt>
          <dd>
            {units(asset?.topUp, asset?.decimals)} /{" "}
            {units(asset?.buyback, asset?.decimals)} {asset?.symbol}
          </dd>
        </div>
        <div>
          <dt>Pool holdings / expected withdrawal</dt>
          <dd>{p.error ?? expected}</dd>
        </div>
      </dl>
      {operator && p.position.open && asset?.metadataOk && (
        <>
          <div className="action-row">
            <TxButton
              {...props}
              operator
              label="Collect fees"
              prepare={() => ({
                address: contract(r, "LpDesk"),
                abi: r.abis.LpDesk,
                functionName: "collect",
                args: [BigInt(p.id)],
                summary: `Collect position #${p.id} fees. NOTSTOCK goes to Burner; other fees split 25/25/25/25.`,
              })}
            />
          </div>
          <Field
            label={`Position #${p.id} manual slippage (%)`}
            value={slip}
            onChange={setSlip}
            inputMode="decimal"
            hint="Applies separately to each withdrawal and redeposit amount. Preview excludes uncollected fees."
          />
          <p>
            Minimum withdrawal: {units(notIs0 ? min0 : min1)} NOTSTOCK +{" "}
            {units(notIs0 ? min1 : min0, asset?.decimals ?? 18)} {asset?.symbol}
            .
          </p>
          <TxButton
            {...props}
            operator
            label="Close position"
            disabled={!!p.error || !validSlip || p.notstock === undefined}
            prepare={() => ({
              address: contract(r, "LpDesk"),
              abi: r.abis.LpDesk,
              functionName: "close",
              args: [BigInt(p.id), min0, min1],
              summary: `Close position #${p.id} at any time. Expected withdrawal: ${expected}. Minimums: token0 ${min0}, token1 ${min1} base units. Fees are split first; the remaining withdrawal becomes desk free balance.`,
            })}
          />
          <details>
            <summary>Shift range</summary>
            <div className="form-grid">
              <Field
                label={`New from (${asset?.symbol} per NOTSTOCK)`}
                value={from}
                onChange={setFrom}
                inputMode="decimal"
              />
              <Field
                label={`New to (${asset?.symbol} per NOTSTOCK)`}
                value={to}
                onChange={setTo}
                inputMode="decimal"
              />
            </div>
            {shift.error && <p className="error">{errorText(shift.error)}</p>}
            {shift.data && (
              <p>
                Ticks {shift.data.lower} to {shift.data.upper}. Expected
                redeposit: {units(shift.data.not)} NOTSTOCK +{" "}
                {units(shift.data.asset, asset?.decimals)} {asset?.symbol}.
                Minimum redeposits: token0 {shift.data.dep0.toString()}, token1{" "}
                {shift.data.dep1.toString()} base units.
              </p>
            )}
            <TxButton
              {...props}
              operator
              label="Shift range"
              disabled={!shift.data || shift.isFetching || !validSlip}
              prepare={() => ({
                address: contract(r, "LpDesk"),
                abi: r.abis.LpDesk,
                functionName: "shift",
                args: [
                  BigInt(p.id),
                  shift.data!.lower,
                  shift.data!.upper,
                  min0,
                  min1,
                  shift.data!.dep0,
                  shift.data!.dep1,
                ],
                summary: `Shift position #${p.id} to ticks ${shift.data!.lower}–${shift.data!.upper}. Collect and split fees, withdraw and redeposit using your ${slip}% per-token slippage limits.`,
              })}
            />
          </details>
          <details>
            <summary>Top up liquidity</summary>
            <div className="amount-head">
              <span>
                Top-up basket: {units(asset?.topUp, asset?.decimals)}{" "}
                {asset?.symbol}
              </span>
              <button
                disabled={!asset}
                onClick={() => setTopup(exact(asset!.topUp, asset!.decimals))}
              >
                Max
              </button>
            </div>
            <Field
              label="Asset amount to top up"
              value={topup}
              onChange={setTopup}
              inputMode="decimal"
            />
            {top.error && <p className="error">{errorText(top.error)}</p>}
            {top.data && (
              <p>
                Expected asset used: {units(top.data.used, asset?.decimals)}{" "}
                {asset?.symbol}. Minimum liquidity (99.5%):{" "}
                {top.data.min.toString()}. No NOTSTOCK is added.
              </p>
            )}
            <TxButton
              {...props}
              operator
              label="Top up position"
              disabled={!top.data || top.isFetching || !!top.error}
              prepare={() => ({
                address: contract(r, "LpDesk"),
                abi: r.abis.LpDesk,
                functionName: "increaseLiquidity",
                args: [BigInt(p.id), top.data!.n, p.sqrtPrice!, top.data!.min],
                summary: `Top up position #${p.id} with up to ${topup} ${asset?.symbol} from its top-up basket. Price tolerance 0.5%; minimum liquidity ${top.data!.min.toString()} (99.5%).`,
              })}
            />
          </details>
          {!same(p.position.asset, r.deployment.network.pairToken.address) && (
            <details>
              <summary>Buy back and burn</summary>
              <div className="amount-head">
                <span>
                  Buyback basket: {units(asset?.buyback, asset?.decimals)}{" "}
                  {asset?.symbol}
                </span>
                <button
                  onClick={() =>
                    setBuyback(exact(asset!.buyback, asset!.decimals))
                  }
                >
                  Max
                </button>
              </div>
              <Field
                label="Asset amount for buyback"
                value={buyback}
                onChange={setBuyback}
                inputMode="decimal"
              />
              <button
                disabled={
                  !buyback ||
                  buy.isFetching ||
                  !asset?.metadataOk ||
                  !p.sqrtPrice
                }
                onClick={() => buy.refetch()}
              >
                {buy.isFetching ? "Simulating buyback…" : "Quote buyback"}
              </button>
              {buy.error && <p className="error">{errorText(buy.error)}</p>}
              {buy.data && (
                <p>
                  Expected out: {exact(buy.data.out)} NOTSTOCK. Minimum:{" "}
                  {validSlip
                    ? exact(minimum(buy.data.out, slippage(slip)))
                    : "Set valid slippage"}{" "}
                  NOTSTOCK.
                </p>
              )}
              <TxButton
                {...props}
                operator
                label="Buy back from basket"
                disabled={!buy.data || buy.isFetching || !validSlip}
                prepare={() => {
                  if (Date.now() - buy.data!.at > 60000)
                    throw Error("Buyback quote expired. Quote again.");
                  return {
                    address: contract(r, "LpDesk"),
                    abi: r.abis.LpDesk,
                    functionName: "buyback",
                    args: [
                      BigInt(p.id),
                      checkedAmount(
                        buyback,
                        asset!.decimals,
                        asset!.buyback,
                        `${asset!.symbol} buyback basket`,
                      ),
                      minimum(buy.data!.out, slippage(slip)),
                    ],
                    summary: `Spend up to ${buyback} ${asset!.symbol} from its buyback basket. Send all NOTSTOCK output directly to the dead address; minimum ${exact(minimum(buy.data!.out, slippage(slip)))} NOTSTOCK.`,
                  };
                }}
              />
            </details>
          )}
          <details>
            <summary>Move liquidity to another position</summary>
            <Select
              label="Destination open position"
              value={moveTarget}
              onChange={setMoveTarget}
            >
              <option value="">Choose a position</option>
              {s?.positions
                .filter(
                  (q) =>
                    q.id !== p.id &&
                    q.position.open &&
                    same(q.position.asset, p.position.asset),
                )
                .map((q) => (
                  <option key={q.id} value={q.id}>
                    Position #{q.id}
                  </option>
                ))}
            </Select>
            <Field
              label="Liquidity units to move"
              value={moveLiq}
              onChange={setMoveLiq}
              inputMode="numeric"
            />
            <p className="hint">
              Withdrawal minimums use the fraction of liquidity moved and your
              slippage. Destination minimums are quoted for its current range.
            </p>
            <TxButton
              {...props}
              operator
              label="Move liquidity"
              disabled={!moveTarget || !moveLiq || !validSlip || !p.liquidity}
              prepare={async () => {
                const liq = BigInt(moveLiq);
                if (liq <= 0n || liq > p.liquidity!)
                  throw Error(
                    "Choose liquidity above zero and within this position’s balance.",
                  );
                const target = s!.positions.find(
                  (q) => q.id === Number(moveTarget),
                )!;
                if (!target.sqrtPrice)
                  throw Error("Destination pool price unavailable.");
                const not = (p.notstock! * liq) / p.liquidity!,
                  a = (p.assetAmount! * liq) / p.liquidity!;
                const m = target.position.kind === 0 ? s!.venueV4 : s!.venueV3,
                  ab =
                    r.abis[target.position.kind === 0 ? "VenueV4" : "VenueV3"];
                let q = (await r.client.readContract({
                  address: m,
                  abi: ab,
                  functionName: "quote",
                  args: [target.position, target.sqrtPrice, not, false],
                })) as [bigint, bigint, bigint];
                if (q[1] > a || !q[2])
                  q = (await r.client.readContract({
                    address: m,
                    abi: ab,
                    functionName: "quote",
                    args: [target.position, target.sqrtPrice, a, true],
                  })) as [bigint, bigint, bigint];
                if (!q[2])
                  throw Error("Destination range cannot take this liquidity.");
                const [o0, o1] = notIs0 ? [not, a] : [a, not],
                  [d0, d1] = notIs0 ? [q[0], q[1]] : [q[1], q[0]],
                  bps = slippage(slip);
                return {
                  address: contract(r, "LpDesk"),
                  abi: r.abis.LpDesk,
                  functionName: "moveLiquidity",
                  args: [
                    BigInt(p.id),
                    BigInt(moveTarget),
                    liq,
                    minimum(o0, bps),
                    minimum(o1, bps),
                    minimum(d0, bps),
                    minimum(d1, bps),
                  ],
                  summary: `Move ${liq} liquidity units from #${p.id} to #${moveTarget}. Expected withdrawal ${exact(not)} NOTSTOCK + ${exact(a, asset!.decimals)} ${asset!.symbol}; expected redeposit ${exact(q[0])} NOTSTOCK + ${exact(q[1], asset!.decimals)} ${asset!.symbol}. All minimums use ${slip}% slippage; unused tokens stay free.`,
                };
              }}
            />
          </details>
        </>
      )}
    </article>
  );
}
function VaultBuyback(props: PageProps) {
  const { r, s } = props;
  const [value, setValue] = useState(""),
    [slip, setSlip] = useState("0.5");
  const q = useQuery({
    queryKey: ["vault-buyback", value],
    enabled: false,
    retry: false,
    queryFn: () => {
      const n = checkedAmount(
        value,
        r.deployment.network.pairToken.decimals,
        s!.bucket,
        "vault IMD buyback",
      );
      const token = contract(r, "LaunchToken");
      const price = s?.poolSqrt
        ? priceFromSqrt(
            s.poolSqrt,
            same(r.deployment.poolKey.currency0, token),
            r.deployment.network.pairToken.decimals,
          )
        : 1;
      return quoteBuyback(
        props,
        contract(r, "FirmVault"),
        r.abis.FirmVault,
        [n],
        BigInt(Math.max(1, Math.floor((Number(exact(n)) / price) * 1e18))),
      );
    },
  });
  let valid = true;
  try {
    slippage(slip);
  } catch {
    valid = false;
  }
  return (
    <Panel title="Vault buyback">
      <div className="amount-head">
        <span>Buyback bucket: {units(s?.bucket)} IMD</span>
        <button onClick={() => setValue(exact(s!.bucket))}>Max</button>
      </div>
      <div className="form-grid">
        <Field
          label="IMD to spend from vault"
          value={value}
          onChange={setValue}
          inputMode="decimal"
        />
        <Field
          label="Vault buyback slippage (%)"
          value={slip}
          onChange={setSlip}
          inputMode="decimal"
        />
      </div>
      <button
        onClick={() => q.refetch()}
        disabled={!value || q.isFetching || !s?.registered}
      >
        {q.isFetching ? "Simulating buyback…" : "Quote vault buyback"}
      </button>
      {q.error && <p className="error">{errorText(q.error)}</p>}
      {q.data && (
        <p>
          Expected out: {exact(q.data.out)} NOTSTOCK. Minimum:{" "}
          {valid
            ? exact(minimum(q.data.out, slippage(slip)))
            : "Set valid slippage"}{" "}
          NOTSTOCK.
        </p>
      )}
      <TxButton
        {...props}
        operator
        label="Buy back from vault"
        disabled={!q.data || q.isFetching || !valid || !s?.registered}
        prepare={() => {
          if (Date.now() - q.data!.at > 60000)
            throw Error("Buyback quote expired. Quote again.");
          return {
            address: contract(r, "FirmVault"),
            abi: r.abis.FirmVault,
            functionName: "buyback",
            args: [
              checkedAmount(value, 18, s!.bucket, "vault IMD buyback"),
              minimum(q.data!.out, slippage(slip)),
            ],
            summary: `Spend up to ${value} IMD from FirmVault’s buyback bucket; burn all NOTSTOCK received. Minimum out: ${exact(minimum(q.data!.out, slippage(slip)))} NOTSTOCK.`,
          };
        }}
      />
    </Panel>
  );
}
