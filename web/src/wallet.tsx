import { useState } from "react";
import { useAccount, useConnect, useDisconnect, type Connector } from "wagmi";
import type { Runtime } from "./config";
import { Dialog, AddressLink } from "./ui";
import { errorText } from "./errors";
import { getAddress } from "viem";
const mobile = () =>
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) &&
  !(window as unknown as { ethereum?: unknown }).ethereum;
export const OPEN_IN = [
  {
    id: "metamask",
    name: "MetaMask",
    href: (url: string) =>
      `https://link.metamask.io/dapp/${url.replace(/^https?:\/\//, "")}`,
  },
  {
    id: "coinbase",
    name: "Coinbase Wallet",
    href: (url: string) =>
      `https://go.cb-w.com/dapp?cb_url=${encodeURIComponent(url)}`,
  },
  {
    id: "rabby",
    name: "Rabby",
    href: (url: string) =>
      `https://go.rabby.io/mobile/?_cmd=open-dapp&dapp=${encodeURIComponent(url)}`,
  },
  {
    id: "phantom",
    name: "Phantom",
    href: (url: string) =>
      `https://phantom.app/ul/browse/${encodeURIComponent(url)}?ref=${encodeURIComponent(new URL(url).origin)}`,
  },
];
export async function switchNetwork(
  provider: { request: (args: any) => Promise<unknown> },
  r: Runtime,
) {
  const params = [{ chainId: `0x${r.deployment.chainId.toString(16)}` }];
  try {
    await provider.request({ method: "wallet_switchEthereumChain", params });
  } catch (e) {
    const err = e as {
      code?: number;
      cause?: { code?: number };
      message?: string;
    };
    if (
      err.code !== 4902 &&
      err.cause?.code !== 4902 &&
      !/unknown chain|unrecognized chain|not added/i.test(err.message ?? "")
    )
      throw e;
    if (!r.deployment.walletAddChain)
      throw Error("This network cannot be added automatically.");
    await provider.request({
      method: "wallet_addEthereumChain",
      params: [r.deployment.walletAddChain],
    });
    await provider.request({ method: "wallet_switchEthereumChain", params });
  }
}
export function Wallet({ r }: { r: Runtime }) {
  const { address, isConnected, chainId, connector } = useAccount();
  const { connectors, connectAsync } = useConnect();
  const { disconnect } = useDisconnect();
  const [open, setOpen] = useState(false),
    [error, setError] = useState(""),
    [pending, setPending] = useState("");
  const isMobile = mobile();
  const named = connectors.some(
    (c) => c.type === "injected" && c.id !== "injected",
  );
  const listed = [
    ...connectors.filter((c) => c.type === "injected"),
    ...connectors.filter((c) => c.type !== "injected"),
  ].filter(
    (c) =>
      !(c.id === "injected" && named) && (!isMobile || c.type !== "injected"),
  );
  async function connect(c: Connector) {
    if (pending) return;
    setPending(c.uid);
    setError("");
    try {
      await connectAsync({ connector: c });
      const p = (await c.getProvider()) as {
        request: (args: any) => Promise<unknown>;
      };
      await switchNetwork(p, r);
      setOpen(false);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending("");
    }
  }
  async function switchChain() {
    if (!connector || pending) return;
    setPending("switch");
    setError("");
    try {
      await switchNetwork(
        (await connector.getProvider()) as {
          request: (args: any) => Promise<unknown>;
        },
        r,
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending("");
    }
  }
  const short = address
    ? `${getAddress(address).slice(0, 6)}…${address.slice(-4)}`
    : "";
  return (
    <div className="wallet-control">
      {isConnected && chainId !== r.deployment.chainId ? (
        <button className="primary" disabled={!!pending} onClick={switchChain}>
          {pending ? "Switching…" : `Switch to ${r.deployment.network.name}`}
        </button>
      ) : (
        <button
          className="primary"
          onClick={() => {
            setError("");
            setOpen(true);
          }}
        >
          {isConnected ? short : "Connect"}
        </button>
      )}
      {error && !open && (
        <small className="error" role="alert">
          {error}
        </small>
      )}
      {open && (
        <Dialog
          title={isConnected ? "Connected wallet" : "Connect a wallet"}
          onClose={() => setOpen(false)}
        >
          {isConnected ? (
            <>
              <p className="full-address">{address && getAddress(address)}</p>
              {address && (
                <AddressLink
                  r={r}
                  address={address}
                  label="View connected wallet"
                />
              )}
              <p>
                Connected to {r.deployment.network.name}. Your wallet signs each
                transaction.
              </p>
              <button
                className="wide"
                onClick={() => {
                  disconnect();
                  setOpen(false);
                }}
              >
                Disconnect
              </button>
            </>
          ) : (
            <>
              <p className="muted">Choose a wallet. Signing stays with you.</p>
              {isMobile &&
                OPEN_IN.map((w) => (
                  <a
                    className="wallet-row"
                    key={w.id}
                    href={w.href(location.href)}
                  >
                    <img
                      width="28"
                      height="28"
                      src={`./wallets/${w.id}.svg`}
                      alt=""
                    />
                    Open in {w.name}
                    <span aria-hidden="true">↗</span>
                  </a>
                ))}
              {listed.map((c) => (
                <button
                  className="wallet-row"
                  key={c.uid}
                  disabled={!!pending}
                  onClick={() => connect(c)}
                >
                  <img
                    width="28"
                    height="28"
                    alt=""
                    src={
                      c.icon?.startsWith("data:")
                        ? c.icon
                        : c.id === "coinbaseWalletSDK"
                          ? "./wallets/coinbase.svg"
                          : "./wallets/browser.svg"
                    }
                  />
                  <span>
                    {c.id === "injected"
                      ? "Browser wallet"
                      : c.id === "coinbaseWalletSDK" && isMobile
                        ? "Coinbase Smart Wallet"
                        : c.name}
                    {pending === c.uid ? " · Opening…" : ""}
                  </span>
                </button>
              ))}
            </>
          )}
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
        </Dialog>
      )}
    </div>
  );
}
