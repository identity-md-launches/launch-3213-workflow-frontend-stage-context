import type { ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { contract, same, type Runtime } from "./config";
import type { Snapshot } from "./types";
import { priceFromSqrt, units } from "./math";
import { AddressLink, Empty, Panel, Stat, TxButton } from "./ui";
import { Swap } from "./swap";
import { history } from "./history";
export type PageProps = {
  r: Runtime;
  s?: Snapshot;
  reload: () => Promise<unknown>;
  notice?: ReactNode;
};
export function Home({ r, s, reload, notice }: PageProps) {
  const token = contract(r, "LaunchToken"),
    imd = r.deployment.network.pairToken;
  const price = s?.poolSqrt
    ? priceFromSqrt(
        s.poolSqrt,
        same(r.deployment.poolKey.currency0, token),
        imd.decimals,
      )
    : undefined;
  return (
    <>
      <div className="page-intro">
        <div>
          <h1>The firm’s ledger.</h1>
          <p>Fees, burns and liquidity. Open to everyone.</p>
        </div>
        <a className="quiet-link" href="#lp-desk">
          Visit the LP Desk <span aria-hidden="true">↗</span>
        </a>
      </div>
      <div className="home-grid">
        <div className="ledger-main">
          <div className="metrics">
            <Stat
              label="NOTSTOCK price"
              value={
                price === undefined
                  ? "Unavailable"
                  : new Intl.NumberFormat("en-US", {
                      maximumSignificantDigits: 6,
                    }).format(price)
              }
              unit="IMD"
              detail="From the launch pool"
            />
            <Stat
              label="Buyback reserve"
              value={units(s?.bucket)}
              unit="IMD"
              detail="Held by FirmVault"
            />
            <Stat
              label="Total burned"
              value={units(s?.deadBalance, 18, 0)}
              unit="NOTSTOCK"
              detail="At the dead address"
            />
          </div>
          <Panel
            title="Put fees to work"
            className="fee-panel"
            aside={<span className="pill">Anyone can distribute</span>}
          >
            <p className="muted">
              Undistributed fees are waiting in FirmVault.
            </p>
            <div className="distribution-row">
              <div>
                <span>IMD</span>
                <strong>{units(s?.undistributedImd)}</strong>
              </div>
              <TxButton
                r={r}
                s={s}
                reload={reload}
                label="Distribute IMD"
                disabled={!s?.registered || !s?.undistributedImd}
                prepare={() => ({
                  address: contract(r, "FirmVault"),
                  abi: r.abis.FirmVault,
                  functionName: "distribute",
                  args: [imd.address],
                  summary:
                    "Distribute the vault’s undistributed IMD: 25% buyback, 25% project wallet, 25% desk top-up and 25% desk free balance.",
                })}
              />
            </div>
            <div className="distribution-row">
              <div>
                <span>NOTSTOCK</span>
                <strong>{units(s?.undistributedNot)}</strong>
              </div>
              <TxButton
                r={r}
                s={s}
                reload={reload}
                label="Distribute NOTSTOCK"
                disabled={!s?.registered || !s?.undistributedNot}
                prepare={() => ({
                  address: contract(r, "FirmVault"),
                  abi: r.abis.FirmVault,
                  functionName: "distribute",
                  args: [token],
                  summary:
                    "Send all undistributed NOTSTOCK from FirmVault to Burner. Anyone may burn it afterwards.",
                })}
              />
            </div>
            {s && !s.registered && (
              <p className="warning">
                The launch is not registered yet. Distribution opens after
                setup.
              </p>
            )}
            <div className="split-bar" aria-hidden="true">
              <i />
              <i />
              <i />
              <i />
            </div>
            <div className="split-legend">
              {[
                "Buyback",
                "Project wallet",
                "Top-up basket",
                "Free balance",
              ].map((t) => (
                <div key={t}>
                  <strong>25%</strong>
                  <span>{t}</span>
                </div>
              ))}
            </div>
            <small>
              NOTSTOCK fees go entirely to Burner. The pool’s 1% fee share
              reaches this vault after launch setup.
            </small>
          </Panel>
        </div>
        <aside className="trade-panel">
          <Swap r={r} s={s} reload={reload} />
          {notice}
        </aside>
      </div>
      <PositionsSummary r={r} s={s} />
      <Panel title="Desk balances">
        <p className="muted">
          Baskets stay separate from each asset’s free balance.
        </p>
        {s ? (
          <div className="data-table" role="table" aria-label="Desk balances">
            <div className="table-row table-head" role="row">
              <span role="columnheader">Asset</span>
              <span role="columnheader">Free</span>
              <span role="columnheader">Top-up</span>
              <span role="columnheader">Buyback</span>
            </div>
            {s.tokens.map((t) => (
              <div className="table-row" role="row" key={t.address}>
                <span role="cell">
                  <AddressLink r={r} address={t.address} label={t.symbol} />
                </span>
                {[t.free, t.topUp, t.buyback].map((a, i) => (
                  <span role="cell" key={i} title={a?.toString()}>
                    {t.metadataOk
                      ? units(a, t.decimals)
                      : "Metadata unavailable"}
                  </span>
                ))}
              </div>
            ))}
          </div>
        ) : (
          <Empty>Loading live desk balances.</Empty>
        )}
      </Panel>
      <WeeklyReport r={r} s={s} />
    </>
  );
}
export function PositionsSummary({ r, s }: { r: Runtime; s?: Snapshot }) {
  const positions = s?.positions.filter((p) => p.position.open);
  return (
    <Panel
      title="Working liquidity"
      aside={<a href="#lp-desk">View positions ↗</a>}
    >
      {!positions ? (
        <Empty>Loading positions from LpDesk.</Empty>
      ) : !positions.length ? (
        <Empty>
          No open positions. The LP Desk shows proposal and bootstrap status.
        </Empty>
      ) : (
        <div className="position-summary">
          {positions.map((p) => {
            const asset = s!.tokens.find((t) =>
              same(t.address, p.position.asset),
            );
            return (
              <div className="ledger-row" key={p.id}>
                <div>
                  <strong>Position #{p.id}</strong>
                  <small>{asset?.symbol ?? p.position.asset} / NOTSTOCK</small>
                </div>
                <div>
                  {p.error ? (
                    <span>Valuation unavailable</span>
                  ) : (
                    <>
                      <span>
                        {units(p.notstock)} NOTSTOCK +{" "}
                        {asset?.metadataOk
                          ? units(p.assetAmount, asset.decimals)
                          : "Unavailable"}{" "}
                        {asset?.symbol}
                      </span>
                      <small>Pool holdings, excluding uncollected fees</small>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
export function WeeklyReport({ r, s }: { r: Runtime; s?: Snapshot }) {
  const q = useQuery({
    queryKey: ["history", r.deployment.sourceCommit],
    queryFn: () => history(r, s!),
    enabled: !!s,
    staleTime: 60000,
    retry: false,
  });
  const h = s ? q.data : undefined;
  const tokenLabel = (addr: string) =>
    s?.tokens.find((t) => same(t.address, addr));
  const rows = (totals: Record<string, bigint>) =>
    Object.entries(totals).map(([address, n]) => {
      const t = tokenLabel(address);
      return (
        <div className="ledger-row" key={address}>
          <span>{t?.symbol ?? address}</span>
          <strong>
            {t?.metadataOk
              ? units(n, t.decimals)
              : `${n.toString()} base units (decimals unavailable)`}
          </strong>
        </div>
      );
    });
  return (
    <Panel
      title="The weekly report"
      aside={
        <button onClick={() => q.refetch()} disabled={!s || q.isFetching}>
          {q.isFetching ? "Reading history…" : "Refresh report"}
        </button>
      }
    >
      <p className="muted">
        Live fee receipts, buybacks and the change at the dead address over the
        last seven days.
      </p>
      {q.error ? (
        <p className="warning">
          History is unavailable from the public RPC. Retry the report; no
          totals have been estimated.
        </p>
      ) : !h ? (
        <Empty>
          Reading chain history. The first report can take a moment.
        </Empty>
      ) : (
        <>
          <small>
            Through block {h.end.toString()} · Since{" "}
            {new Date(Number(h.since) * 1000).toLocaleString()}
          </small>
          <div className="report-grid">
            <div>
              <h3>Vault fee receipts</h3>
              {Object.keys(h.weekly).length ? (
                rows(h.weekly)
              ) : (
                <p>No fee receipts in this window.</p>
              )}
              <small>Excludes internal desk credits.</small>
              <h3>LP fees collected</h3>
              {Object.keys(h.lpFees).length ? (
                rows(h.lpFees)
              ) : (
                <p>No collected fees in this window.</p>
              )}
            </div>
            <div>
              <h3>Buyback executions</h3>
              {h.buybacks.length ? (
                h.buybacks.map((e) => (
                  <div
                    className="ledger-row"
                    key={`${e.transactionHash}-${e.logIndex}`}
                  >
                    <a
                      href={`${r.deployment.network.explorer}/tx/${e.transactionHash}`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      Block {e.blockNumber.toString()} ↗
                    </a>
                    <span>{units(e.args.notstockOut)} NOTSTOCK burned</span>
                  </div>
                ))
              ) : (
                <p>No buybacks in this window.</p>
              )}
              <h3>Dead-address balance change</h3>
              <strong>{units(h.deadChange)} NOTSTOCK</strong>
            </div>
          </div>
          <div className="report-total">
            <h3>Project wallet received</h3>
            <AddressLink r={r} address={s!.projectWallet} />
            <small>
              Cumulative fees from FirmVault and LpDesk since deployment.
            </small>
            {Object.keys(h.totals).length ? (
              rows(h.totals)
            ) : (
              <p>No project fee transfers recorded.</p>
            )}
          </div>
        </>
      )}
    </Panel>
  );
}
