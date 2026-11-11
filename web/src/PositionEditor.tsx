import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { contract, same, venueLabel } from "./config";
import {
  bootstrapActive,
  checkedAmount,
  exact,
  priceFromSqrt,
  rangeTicks,
  sqrtFromPrice,
  units,
} from "./math";
import { Field, Select, TxButton } from "./ui";
import type { PageProps } from "./Home";
import type { Position } from "./types";
import type { Address } from "viem";
import { errorText } from "./errors";
export function PositionEditor({
  r,
  s,
  reload,
  proposal = false,
}: { proposal?: boolean } & PageProps) {
  const [assetAddress, setAssetAddress] = useState(""),
    [venueAddress, setVenueAddress] = useState(""),
    [fee, setFee] = useState("3000"),
    [spacing, setSpacing] = useState("60"),
    [price, setPrice] = useState(""),
    [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [value, setValue] = useState("");
  const [priceManual, setPriceManual] = useState(false);
  const token = contract(r, "LaunchToken");
  const asset = s?.tokens.find((t) => same(t.address, assetAddress)),
    venue = s?.venues.find((v) => same(v.manager, venueAddress));
  const freeNot = s?.tokens.find((t) => same(t.address, token))?.free ?? 0n;
  useEffect(() => {
    if (!assetAddress && s?.tokens[1]) setAssetAddress(s.tokens[1].address);
    if (!venueAddress && s?.venues[0]) setVenueAddress(s.venues[0].manager);
  }, [s, assetAddress, venueAddress]);
  const notIs0 = token.toLowerCase() < assetAddress.toLowerCase();
  const mod = venue?.kind === 0 ? "VenueV4" : "VenueV3";
  const modAddress = venue?.kind === 0 ? s?.venueV4 : s?.venueV3;
  const initial: Position = {
    manager: venueAddress as Address,
    kind: venue?.kind ?? 0,
    asset: assetAddress as Address,
    fee: Number(fee),
    tickSpacing: Number(spacing),
    tickLower: 0,
    tickUpper: 0,
    tokenId: 0n,
    open: true,
  };
  const pool = useQuery({
    queryKey: [
      "pool",
      assetAddress,
      venueAddress,
      fee,
      spacing,
      s?.block.toString(),
    ],
    enabled: !!asset?.metadataOk && !!venue && !!s?.moduleReady[mod],
    retry: false,
    queryFn: async () => {
      if (
        !Number.isInteger(Number(fee)) ||
        Number(fee) < 0 ||
        Number(fee) > 16777215 ||
        !Number.isInteger(Number(spacing)) ||
        Number(spacing) <= 0
      )
        throw Error("Choose a valid fee and positive tick spacing.");
      const prepared = (await r.client.readContract({
        address: modAddress!,
        abi: r.abis[mod],
        functionName: "prepare",
        args: [initial],
      })) as Position;
      const [sqrt, exists] = (await r.client.readContract({
        address: modAddress!,
        abi: r.abis[mod],
        functionName: "poolPrice",
        args: [prepared],
      })) as [bigint, boolean];
      return { position: prepared, sqrt, exists };
    },
  });
  useEffect(() => {
    if (!priceManual && pool.data) {
      setPrice(
        pool.data.exists
          ? String(priceFromSqrt(pool.data.sqrt, notIs0, asset!.decimals))
          : "",
      );
    }
  }, [pool.data, priceManual, notIs0, asset]);
  function resetPool() {
    setPriceManual(false);
    setPrice("");
    setFrom("");
    setTo("");
  }
  function preset(factor: number) {
    const p = pool.data?.exists
      ? priceFromSqrt(pool.data.sqrt, notIs0, asset!.decimals)
      : Number(price);
    if (p > 0) {
      setFrom(String(p * (factor === 2 ? 0.5 : 1 - factor)));
      setTo(String(p * (factor === 2 ? 2 : 1 + factor)));
    }
  }
  const preview = useQuery({
    queryKey: [
      "position-preview",
      assetAddress,
      venueAddress,
      fee,
      spacing,
      price,
      from,
      to,
      value,
      pool.data?.sqrt.toString(),
      s?.block.toString(),
    ],
    enabled: !!pool.data && !!price && !!from && !!to && !!value,
    retry: false,
    queryFn: async () => {
      if (!asset?.metadataOk)
        throw Error("Token metadata is unavailable. Refresh to continue.");
      const amount = checkedAmount(value, 18, freeNot, "free NOTSTOCK");
      const sqrt = sqrtFromPrice(price, notIs0, asset.decimals);
      const [tickLower, tickUpper] = rangeTicks(
        from,
        to,
        notIs0,
        asset.decimals,
        pool.data!.position.tickSpacing,
      );
      const position = { ...pool.data!.position, tickLower, tickUpper };
      const at = pool.data!.exists ? pool.data!.sqrt : sqrt;
      const [amountNot, amountAsset, liquidity] = (await r.client.readContract({
        address: modAddress!,
        abi: r.abis[mod],
        functionName: "quote",
        args: [position, at, amount, false],
      })) as [bigint, bigint, bigint];
      if (amountNot === 0n || liquidity === 0n)
        throw Error(
          "This range takes no NOTSTOCK. Choose a range containing or above the NOTSTOCK price.",
        );
      if (amountNot > freeNot)
        throw Error(
          "The quote exceeds free NOTSTOCK by rounding. Lower the amount slightly.",
        );
      if (asset.free === undefined)
        throw Error("Asset balance is unavailable. Refresh before continuing.");
      if (amountAsset > asset.free)
        throw Error(
          `The range needs more free ${asset.symbol} than the desk holds. Reduce the amount or choose a single-sided range.`,
        );
      const [a0, a1] = notIs0
        ? [amountNot, amountAsset]
        : [amountAsset, amountNot];
      return {
        params: {
          asset: asset.address,
          venue: venue!.manager,
          fee: position.fee,
          tickSpacing: position.tickSpacing,
          tickLower,
          tickUpper,
          sqrtPriceX96: sqrt,
          amount,
          amount0Min: (a0 * 9950n) / 10000n,
          amount1Min: (a1 * 9950n) / 10000n,
        },
        amountNot,
        amountAsset,
        liquidity,
        leftNot: freeNot - amountNot,
        leftAsset: asset.free - amountAsset,
      };
    },
  });
  const p = preview.data;
  const bootstrap = !!s && bootstrapActive(s.bootstrapEnd, s.time);
  return (
    <div className="position-editor">
      <div className="form-grid">
        <Select
          label="Pair asset"
          value={assetAddress}
          onChange={(v) => {
            setAssetAddress(v);
            resetPool();
          }}
        >
          {s?.tokens
            .filter((t) => !same(t.address, token))
            .map((t) => (
              <option
                key={t.address}
                value={t.address}
                disabled={!t.metadataOk}
              >
                {t.symbol}
              </option>
            ))}
        </Select>
        <Select
          label="Venue"
          value={venueAddress}
          onChange={(v) => {
            setVenueAddress(v);
            resetPool();
          }}
        >
          {s?.venues.map((v) => (
            <option key={v.manager} value={v.manager}>
              {venueLabel(v.manager)}
            </option>
          ))}
        </Select>
        {venue?.kind === 2 ? (
          <Field
            label="CL tick spacing"
            value={spacing}
            onChange={(v) => {
              setSpacing(v);
              resetPool();
            }}
            inputMode="numeric"
          />
        ) : (
          <>
            <Field
              label="Fee tier (millionths)"
              value={fee}
              onChange={(v) => {
                setFee(v);
                resetPool();
              }}
              inputMode="numeric"
            />
            {venue?.kind === 0 && (
              <Field
                label="V4 tick spacing"
                value={spacing}
                onChange={(v) => {
                  setSpacing(v);
                  resetPool();
                }}
                inputMode="numeric"
              />
            )}
          </>
        )}
        <Field
          label={`Price (${asset?.symbol ?? "asset"} per NOTSTOCK)`}
          value={price}
          onChange={(v) => {
            setPrice(v);
            setPriceManual(true);
          }}
          inputMode="decimal"
          hint="Open fails if the pool price differs from this price by more than 0.5%"
        />
      </div>
      <p className="hint">
        {pool.isFetching
          ? "Reading pool price…"
          : pool.error
            ? errorText(pool.error)
            : pool.data?.exists
              ? `Current pool price: ${priceFromSqrt(pool.data.sqrt, notIs0, asset!.decimals).toPrecision(8)} ${asset?.symbol} per NOTSTOCK`
              : "No pool found. Set the opening price by hand."}
      </p>
      <div
        className="range-presets"
        role="group"
        aria-label="Price range presets"
      >
        <button onClick={() => preset(0.2)}>Narrow ±20%</button>
        <button onClick={() => preset(0.5)}>Medium ±50%</button>
        <button onClick={() => preset(2)}>Wide 2×</button>
        <span>or enter manually</span>
      </div>
      <div className="form-grid">
        <Field
          label={`From (${asset?.symbol ?? "asset"} per NOTSTOCK)`}
          value={from}
          onChange={setFrom}
          inputMode="decimal"
        />
        <Field
          label={`To (${asset?.symbol ?? "asset"} per NOTSTOCK)`}
          value={to}
          onChange={setTo}
          inputMode="decimal"
        />
      </div>
      <div className="amount-head">
        <span>Desk free: {units(freeNot)} NOTSTOCK</span>
        <button
          disabled={!s}
          onClick={() => setValue(exact(freeNot > 1n ? freeNot - 1n : 0n))}
        >
          Max
        </button>
      </div>
      <Field
        label="NOTSTOCK to put to work"
        value={value}
        onChange={setValue}
        inputMode="decimal"
        hint="Max leaves one base unit for position rounding."
      />
      {preview.error && (
        <p className="error" role="alert">
          {errorText(preview.error)}
        </p>
      )}
      {p && (
        <div className="preview">
          <h3>Position preview</h3>
          <dl>
            <div>
              <dt>Lower / upper ticks</dt>
              <dd>
                {p.params.tickLower} / {p.params.tickUpper}
              </dd>
            </div>
            <div>
              <dt>Deposit</dt>
              <dd>
                {exact(p.amountNot)} NOTSTOCK +{" "}
                {exact(p.amountAsset, asset!.decimals)} {asset!.symbol}
              </dd>
            </div>
            <div>
              <dt>99.5% minimum deposits</dt>
              <dd>
                {exact((p.amountNot * 9950n) / 10000n)} NOTSTOCK +{" "}
                {exact((p.amountAsset * 9950n) / 10000n, asset!.decimals)}{" "}
                {asset!.symbol}
              </dd>
            </div>
            <div>
              <dt>Left in desk</dt>
              <dd>
                {exact(p.leftNot)} NOTSTOCK +{" "}
                {exact(p.leftAsset, asset!.decimals)} {asset!.symbol}
              </dd>
            </div>
          </dl>
        </div>
      )}
      <TxButton
        r={r}
        s={s}
        reload={reload}
        label={proposal ? "Propose open position" : "Open position"}
        operator={!proposal}
        disabled={
          !p ||
          preview.isFetching ||
          !!preview.error ||
          (!proposal && !bootstrap) ||
          !!pool.error
        }
        prepare={() => {
          if (!p) throw Error("Build a position preview first.");
          return {
            address: proposal ? s!.lpGovernor : contract(r, "LpDesk"),
            abi: r.abis[proposal ? "LpGovernor" : "LpDesk"],
            functionName: proposal ? "proposeOpenPosition" : "open",
            args: [p.params],
            summary: `${proposal ? "Propose opening" : "Open"} a ${asset!.symbol}/NOTSTOCK position on ${venueLabel(venue!.manager)}, ticks ${p.params.tickLower} to ${p.params.tickUpper}. Quoted deposit: ${exact(p.amountNot)} NOTSTOCK + ${exact(p.amountAsset, asset!.decimals)} ${asset!.symbol}. Minimum deposits are 99.5%.`,
          };
        }}
      />
      {!proposal && !bootstrap && (
        <p className="hint">
          Direct opens are closed. New positions require a passed proposal.
        </p>
      )}
    </div>
  );
}
