import { useAccount } from "wagmi";
import { useQuery } from "@tanstack/react-query";
import { AddressLink, Empty, Panel } from "./ui";
import { same, venueLabel } from "./config";
import { Staking, ProposalForm, Proposals } from "./Governance";
import { ManagedPosition, Operator } from "./Operator";
import { Setup } from "./Setup";
import { history } from "./history";
import { units } from "./math";
import type { PageProps } from "./Home";
export function Desk(props: PageProps) {
  const { r, s } = props;
  const { address } = useAccount();
  const operator = same(address, s?.operator);
  const h = useQuery({
    queryKey: ["history", r.deployment.sourceCommit],
    queryFn: () => history(r, s!),
    enabled: !!s,
    staleTime: 60000,
    retry: false,
  });
  return (
    <>
      <div className="page-intro">
        <div>
          <h1>The LP Desk.</h1>
          <p>Stake, vote and follow the firm’s liquidity.</p>
        </div>
      </div>
      <Staking {...props} />
      <Panel title="Liquidity positions">
        {s?.positions.length ? (
          s.positions.map((p) => (
            <ManagedPosition key={p.id} p={p} {...props} operator={operator} />
          ))
        ) : (
          <Empty>
            No positions recorded yet. New positions begin with bootstrap or
            governance.
          </Empty>
        )}
      </Panel>
      <ProposalForm {...props} />
      <Proposals {...props} />
      <Panel title="Venues & assets">
        <p className="muted">
          Read from PriceGuard. Executed additions appear here automatically.
        </p>
        {s?.venues.length ? (
          <div className="venue-list">
            {s.venues.map((v) => (
              <div className="ledger-row" key={v.manager}>
                <AddressLink
                  r={r}
                  address={v.manager}
                  label={venueLabel(v.manager)}
                />
                <span>{["V4", "V3", "CL"][v.kind]}</span>
              </div>
            ))}
          </div>
        ) : (
          <Empty>
            The venue list is unavailable until PriceGuard is deployed.
          </Empty>
        )}
        <div className="asset-list">
          {s?.tokens.slice(1).map((t) => (
            <AddressLink
              key={t.address}
              r={r}
              address={t.address}
              label={t.symbol}
            />
          ))}
        </div>
      </Panel>
      <Panel title="Bridges">
        <p>
          Bridge records and outgoing transfers are read from governance and
          LpDesk. Governance controls each addition and transfer.
        </p>
        {s?.bridges.length ? (
          s.bridges.map((b, i) => (
            <div className="bridge-record" key={i}>
              <h3>
                Bridge #{i} · Destination {b.dstChainId}
              </h3>
              <p>
                Adapter <AddressLink r={r} address={b.adapter} />
              </p>
              <p>
                Destination desk <AddressLink r={r} address={b.dstLpDesk} />
              </p>
            </div>
          ))
        ) : (
          <Empty>
            No registered bridges. Use an Add bridge proposal to register an
            adapter and destination desk.
          </Empty>
        )}
        <h3>Every BridgeOut</h3>
        {h.error ? (
          <p className="warning">
            Bridge history is unavailable. Refresh the weekly report to retry.
          </p>
        ) : !h.data ? (
          <p>Reading transfer history…</p>
        ) : h.data.bridged.length ? (
          h.data.bridged.map((e) => (
            <div
              className="bridge-record"
              key={`${e.transactionHash}-${e.logIndex}`}
            >
              <p>
                {units(e.args.amount)} NOTSTOCK to chain {e.args.dstEid}
              </p>
              <p>
                Adapter <AddressLink r={r} address={e.args.adapter} />
              </p>
              <p>
                Destination <AddressLink r={r} address={e.args.dstLpDesk} />
              </p>
              <a
                href={`${r.deployment.network.explorer}/tx/${e.transactionHash}`}
                target="_blank"
                rel="noreferrer"
              >
                View bridge transaction ↗
              </a>
            </div>
          ))
        ) : (
          <Empty>No BridgeOut events recorded.</Empty>
        )}
      </Panel>
      {operator ? (
        <Operator {...props} />
      ) : (
        <Panel title="Operator overview">
          <p>
            Operator controls are available only to the desk’s current operator.
            Positions, baskets and proposals remain public.
          </p>
          {s && (
            <>
              <AddressLink
                r={r}
                address={s.operator}
                label="Current operator"
              />
              <p>
                Bootstrap end:{" "}
                {s.bootstrapEnd
                  ? new Date(Number(s.bootstrapEnd) * 1000).toLocaleString()
                  : "Not registered"}
              </p>
              <p>FirmVault buyback reserve: {units(s.bucket)} IMD</p>
              <p>Desk free NOTSTOCK: {units(s.tokens[0]?.free)}</p>
            </>
          )}
        </Panel>
      )}
      <Setup {...props} />
    </>
  );
}
