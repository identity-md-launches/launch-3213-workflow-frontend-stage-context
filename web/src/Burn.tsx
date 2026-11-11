import { useState } from "react";
import { contract, erc20Abi } from "./config";
import { checkedAmount, exact, units } from "./math";
import { AddressLink, Field, Panel, Stat, TxButton, WalletGate } from "./ui";
import type { PageProps } from "./Home";
export function Burn({ r, s, reload }: PageProps) {
  const [value, setValue] = useState("");
  let err = "";
  try {
    if (value && s?.walletBalance !== undefined)
      checkedAmount(value, 18, s.walletBalance, "NOTSTOCK");
  } catch (e) {
    err = (e as Error).message;
  }
  return (
    <>
      <div className="page-intro">
        <div>
          <h1>Off the books. Forever.</h1>
          <p>Send NOTSTOCK to the dead address.</p>
        </div>
      </div>
      <div className="metrics burn-metrics">
        <Stat
          label="Waiting in Burner"
          value={units(s?.burnerBalance)}
          unit="NOTSTOCK"
        />
        <Stat
          label="Total burned"
          value={units(s?.deadBalance, 18, 0)}
          unit="NOTSTOCK"
        />
        <Stat
          label="Fixed supply"
          value="1,000,000,000"
          unit="NOTSTOCK"
          detail="No minting. Burning does not change totalSupply."
        />
      </div>
      <div className="two-columns">
        <Panel title="Burn the balance">
          <p>
            Anyone can send Burner’s full balance to the dead address. Tokens
            sent there cannot be recovered.
          </p>
          <WalletGate r={r} s={s} />
          <TxButton
            r={r}
            s={s}
            reload={reload}
            className="primary"
            label="Burn NOTSTOCK"
            disabled={!s?.burnerBalance || !s.moduleReady.Burner}
            prepare={() => ({
              address: s!.burner,
              abi: r.abis.Burner,
              functionName: "burn",
              summary: `Permanently send Burner’s entire balance (${exact(s!.burnerBalance)} NOTSTOCK) to the dead address.`,
            })}
          />
          {s && (
            <p className="muted">
              Burner <AddressLink r={r} address={s.burner} />
            </p>
          )}
        </Panel>
        <Panel title="Deposit to Burner">
          <p>
            Transfer tokens from your wallet to Burner. A separate Burn
            transaction sends them to the dead address.
          </p>
          <div className="amount-head">
            <span>Wallet: {units(s?.walletBalance)} NOTSTOCK</span>
            <button
              disabled={s?.walletBalance === undefined}
              onClick={() => setValue(exact(s!.walletBalance!))}
            >
              Max
            </button>
          </div>
          <Field
            label="NOTSTOCK amount"
            inputMode="decimal"
            value={value}
            onChange={setValue}
          />
          {err && (
            <p className="error" role="alert">
              {err}
            </p>
          )}
          <TxButton
            r={r}
            s={s}
            reload={reload}
            label="Deposit NOTSTOCK"
            disabled={
              !value ||
              !!err ||
              s?.walletBalance === undefined ||
              !s?.moduleReady.Burner
            }
            prepare={async () => {
              const balance = await r.client.readContract({
                address: contract(r, "LaunchToken"),
                abi: erc20Abi,
                functionName: "balanceOf",
                args: [
                  (await import("wagmi/actions")).getAccount(r.wagmi).address!,
                ],
              });
              return {
                address: contract(r, "LaunchToken"),
                abi: r.abis.LaunchToken,
                functionName: "transfer",
                args: [
                  s!.burner,
                  checkedAmount(value, 18, balance, "NOTSTOCK"),
                ],
                summary: `Transfer ${value} NOTSTOCK from your wallet to Burner. No token approval is needed.`,
              };
            }}
          />
        </Panel>
      </div>
      <Panel title="A public burn ledger">
        <p>
          The total above is the dead address’s NOTSTOCK balance, read directly
          on Base. It includes burns from Burner, FirmVault, LpDesk and plain
          transfers.
        </p>
        {s && (
          <AddressLink r={r} address={s.dead} label="View the dead address" />
        )}
        <p className="muted">
          USD value is unavailable. All amounts are shown in NOTSTOCK.
        </p>
      </Panel>
    </>
  );
}
