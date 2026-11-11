import { useEffect, useId, useRef, useState, type ReactNode } from "react";
import { getAddress, type Address, type Abi, type Hex } from "viem";
import { useAccount, useWalletClient } from "wagmi";
import type { Runtime } from "./config";
import type { Snapshot } from "./types";
import { errorText } from "./errors";
import { same, contract } from "./config";
export function AddressLink({
  address,
  r,
  label,
}: {
  address: Address;
  r: Runtime;
  label?: string;
}) {
  const [copied, setCopied] = useState(false);
  const a = getAddress(address);
  return (
    <span className="address">
      <a
        href={`${r.deployment.network.explorer}/address/${a}`}
        target="_blank"
        rel="noreferrer"
        title={a}
      >
        {label ?? `${a.slice(0, 6)}…${a.slice(-4)}`}
        <span aria-hidden="true"> ↗</span>
      </a>
      <button
        className="copy"
        aria-label={`Copy ${label ?? a}`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(a);
            setCopied(true);
          } catch {
            setCopied(false);
          }
        }}
      >
        {copied ? "Copied" : "Copy"}
      </button>
    </span>
  );
}
export function Field({
  label,
  value,
  onChange,
  hint,
  type = "text",
  ...props
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: ReactNode;
  type?: string;
  inputMode?: "decimal" | "numeric" | "text";
  min?: string;
  step?: string;
  max?: string;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        type={type}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-describedby={hint ? id + "-hint" : undefined}
        {...props}
      />
      {hint && <small id={id + "-hint"}>{hint}</small>}
    </div>
  );
}
export function Select({
  label,
  value,
  onChange,
  children,
}: {
  label: string;
  value: string;
  onChange: (s: string) => void;
  children: ReactNode;
}) {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    </div>
  );
}
export function Panel({
  title,
  children,
  className = "",
  aside,
}: {
  title: string;
  children: ReactNode;
  className?: string;
  aside?: ReactNode;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="section-head">
        <h2>{title}</h2>
        {aside}
      </div>
      {children}
    </section>
  );
}
export function Stat({
  label,
  value,
  unit,
  detail,
}: {
  label: string;
  value: ReactNode;
  unit?: string;
  detail?: ReactNode;
}) {
  return (
    <div className="stat">
      <span className="muted">{label}</span>
      <div className="stat-value">
        {value}
        {unit && <small>{unit}</small>}
      </div>
      {detail && <small>{detail}</small>}
    </div>
  );
}
export function Dialog({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    const previous = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    return () => {
      dialog?.close();
      previous?.focus();
    };
  }, []);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      onCancel={(e) => {
        e.preventDefault();
        onClose();
      }}
      onClick={(e) => {
        if (e.target === ref.current) onClose();
      }}
    >
      <div className="dialog-body">
        <div className="section-head">
          <h2 id={titleId}>{title}</h2>
          <button className="icon-button" aria-label="Close" onClick={onClose}>
            ×
          </button>
        </div>
        {children}
      </div>
    </dialog>
  );
}
export type TxRequest = {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
  value?: bigint;
  summary: string;
};
export function TxButton({
  r,
  s,
  reload,
  label,
  prepare,
  disabled = false,
  operator = false,
  className = "",
  reason,
}: {
  r: Runtime;
  s?: Snapshot;
  reload: () => Promise<unknown>;
  label: string;
  prepare: () => TxRequest | Promise<TxRequest>;
  disabled?: boolean;
  operator?: boolean;
  className?: string;
  reason?: string;
}) {
  const { address, chainId } = useAccount();
  const { data: wallet } = useWalletClient();
  const [status, setStatus] = useState(""),
    [error, setError] = useState(""),
    [hash, setHash] = useState<Hex>(),
    [review, setReview] = useState<{ tx: TxRequest; request: any }>();
  const busy = useRef(false);
  const locked =
    !address || chainId !== r.deployment.chainId || !s?.verified || disabled;
  async function preview() {
    if (busy.current || locked) return;
    busy.current = true;
    setError("");
    setHash(undefined);
    setStatus("Checking transaction…");
    try {
      if (!wallet || (await wallet.getChainId()) !== r.deployment.chainId)
        throw Error("Switch to Base before continuing.");
      if ((await r.client.getChainId()) !== r.deployment.chainId)
        throw Error("RPC is on the wrong chain. Transactions are locked.");
      if (operator) {
        const current = (await r.client.readContract({
          address: contract(r, "LpDesk"),
          abi: r.abis.LpDesk,
          functionName: "operator",
        })) as Address;
        if (!same(current, address))
          throw Error(
            "Connect the desk’s current operator wallet for this action.",
          );
      }
      const tx = await prepare();
      const code = await r.client.getBytecode({ address: tx.address });
      if (!code || code === "0x")
        throw Error("Contract code is unavailable. Transactions are locked.");
      const simulation = await r.client.simulateContract({
        address: tx.address,
        abi: tx.abi,
        functionName: tx.functionName,
        args: tx.args,
        account: address,
        value: tx.value,
      });
      setReview({ tx, request: simulation.request });
      setStatus("Review before signing");
    } catch (e) {
      setError(errorText(e));
      setStatus("");
      busy.current = false;
    }
  }
  async function sign() {
    if (!review || !wallet) return;
    const current = review;
    setReview(undefined);
    setStatus("Confirm in your wallet…");
    try {
      if ((await wallet.getChainId()) !== r.deployment.chainId)
        throw Error("Switch to Base before continuing.");
      const reviewedAccount =
        typeof current.request.account === "string"
          ? current.request.account
          : current.request.account?.address;
      if (
        !same(address, reviewedAccount) ||
        !same((await wallet.getAddresses())[0], address)
      )
        throw Error(
          "The connected wallet changed. Review the action again before signing.",
        );
      const txHash = await wallet.writeContract(current.request);
      setHash(txHash);
      setStatus("Waiting for confirmation…");
      const receipt = await r.client.waitForTransactionReceipt({
        hash: txHash,
        confirmations: 1,
        timeout: 180_000,
      });
      if (receipt.status !== "success")
        throw Error(
          "Transaction reverted. Refresh the balances before trying again.",
        );
      await reload();
      setStatus("Confirmed on Base");
    } catch (e) {
      setError(errorText(e));
      setStatus("");
    } finally {
      busy.current = false;
    }
  }
  return (
    <div className="action">
      <button
        className={className}
        disabled={locked || busy.current}
        onClick={preview}
      >
        {busy.current && !review ? status : label}
      </button>
      {reason && <small>{reason}</small>}
      <div role="status" className="tx-status">
        {status}
        {hash && (
          <>
            {" "}
            ·{" "}
            <a
              href={`${r.deployment.network.explorer}/tx/${hash}`}
              target="_blank"
              rel="noreferrer"
            >
              View transaction ↗
            </a>
          </>
        )}
      </div>
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}
      {review && (
        <Dialog
          title={`Review: ${label}`}
          onClose={() => {
            setReview(undefined);
            setStatus("");
            busy.current = false;
          }}
        >
          <p>{review.tx.summary}</p>
          <p className="muted">
            Base mainnet. Your wallet pays network fees. This action takes
            effect after confirmation.
          </p>
          <AddressLink address={review.tx.address} r={r} />
          <details>
            <summary>Transaction details</summary>
            <pre>
              {JSON.stringify(
                {
                  action: review.tx.functionName,
                  args: review.tx.args,
                  valueWei: review.tx.value ?? 0n,
                },
                (_, v) => (typeof v === "bigint" ? v.toString() : v),
                2,
              )}
            </pre>
          </details>
          <button className="primary wide" onClick={sign}>
            Confirm in wallet
          </button>
        </Dialog>
      )}
    </div>
  );
}
export function Empty({ children }: { children: ReactNode }) {
  return <p className="empty">{children}</p>;
}
export function WalletGate({ r, s }: { r: Runtime; s?: Snapshot }) {
  const { address, chainId } = useAccount();
  return !address ? (
    <p className="hint">
      Connect a wallet to take action. Anyone can read the ledger.
    </p>
  ) : chainId !== r.deployment.chainId ? (
    <p className="warning">
      Switch to {r.deployment.network.name} using the wallet control above.
    </p>
  ) : !s ? (
    <p className="hint">Waiting for verified contract state.</p>
  ) : null;
}
