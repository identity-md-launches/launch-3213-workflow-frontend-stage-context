import { useEffect, useState } from "react";
import { useAccount } from "wagmi";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { Runtime } from "./config";
import { snapshot } from "./data";
import { Home } from "./Home";
import { Burn } from "./Burn";
import { Desk } from "./Desk";
import { Wallet } from "./wallet";
import { AddressLink } from "./ui";
import { errorText } from "./errors";
export function App({ r }: { r: Runtime }) {
  const { address } = useAccount();
  const cache = useQueryClient();
  const [page, setPage] = useState(location.hash.slice(1) || "home");
  useEffect(() => {
    const handler = () => {
      setPage(location.hash.slice(1) || "home");
      window.scrollTo({ top: 0 });
    };
    addEventListener("hashchange", handler);
    return () => removeEventListener("hashchange", handler);
  }, []);
  const data = useQuery({
    queryKey: ["state", address],
    queryFn: () => snapshot(r, address),
    refetchInterval: 15000,
    refetchOnWindowFocus: true,
    retry: 1,
  });
  const s =
    data.error && data.data ? { ...data.data, verified: false } : data.data;
  async function reload() {
    await data.refetch({ throwOnError: true });
    await cache.invalidateQueries({ queryKey: ["history"] });
  }
  const notice = data.error ? (
    <div className="global-error" role="alert">
      <p>
        {errorText(data.error)}
        {s
          ? " Showing the last snapshot. Transaction controls are locked."
          : ""}
      </p>
      <button onClick={() => data.refetch()}>Retry chain reads</button>
    </div>
  ) : undefined;
  const props = { r, s, reload, notice };
  return (
    <>
      <a
        className="skip-link"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </a>
      <header className="site-header">
        <div className="header-top">
          <div className="identity">
            <a href="#home" className="brand" aria-label="The Firm home">
              <img src="./logo.png" width="60" height="60" alt="" />
              <span>
                The Firm<span aria-hidden="true">.</span>
              </span>
            </a>
            <p className="slogan">
              Don't work for the firm. Let the firm work for you.
            </p>
          </div>
          <Wallet r={r} />
        </div>
        <div className="nav-line">
          <nav aria-label="Main navigation">
            {[
              ["home", "Home"],
              ["burn", "Burn"],
              ["lp-desk", "LP Desk"],
            ].map(([id, label]) => (
              <a
                key={id}
                href={`#${id}`}
                aria-current={page === id ? "page" : undefined}
              >
                {label}
              </a>
            ))}
          </nav>
          <span className="network-status">
            <i aria-hidden="true" />
            {r.deployment.network.name}
            <span className="desktop-only">
              {" "}
              · {s?.block ? `Block ${s.block}` : "Reading chain"}
            </span>
          </span>
        </div>
      </header>
      <main id="main" tabIndex={-1}>
        {(page === "burn" || page === "lp-desk") && notice}
        {page === "burn" ? (
          <Burn {...props} />
        ) : page === "lp-desk" ? (
          <Desk {...props} />
        ) : (
          <Home {...props} />
        )}{" "}
        {s?.warnings.length ? (
          <details className="read-notes">
            <summary>{s.warnings.length} chain data notices</summary>
            <ul>
              {s.warnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </details>
        ) : null}
      </main>
      <footer>
        <div className="footer-line">
          <span>The Firm · NOTSTOCK on {r.deployment.network.name}</span>
          <span>Read from chain. Signed by your wallet.</span>
        </div>
        <details>
          <summary>Contracts & deployment</summary>
          <div className="contract-list">
            {r.deployment.contracts.map((c) => (
              <div key={c.name}>
                <span>{c.name}</span>
                <AddressLink r={r} address={c.address} />
              </div>
            ))}
            {s &&
              Object.entries({
                Burner: s.burner,
                LpGovernor: s.lpGovernor,
                PriceGuard: s.priceGuard,
                VenueV3: s.venueV3,
                VenueV4: s.venueV4,
              }).map(([name, address]) => (
                <div key={name}>
                  <span>{name}</span>
                  <AddressLink r={r} address={address} />
                </div>
              ))}
          </div>
          <p className="provenance">
            Source {r.deployment.sourceCommit} · Attestation{" "}
            {r.deployment.attestationHash}
          </p>
          <a href="./imd-deployment.json">View deployment manifest</a>
          <p>
            No analytics, browser storage or server relay. Public RPCs receive
            read requests. The wallet handles signing.
          </p>
        </details>
        <p className="disclaimer">
          NOTSTOCK is a token, not equity. Liquidity and token prices carry
          risk. USD context is unavailable.
        </p>
      </footer>
    </>
  );
}
