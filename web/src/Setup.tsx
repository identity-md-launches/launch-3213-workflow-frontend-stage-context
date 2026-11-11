import { useState } from "react";
import { useAccount } from "wagmi";
import { keccak256, stringToHex, type Hex } from "viem";
import { contract, factoryAbi, same } from "./config";
import { Field, TxButton, Panel, AddressLink } from "./ui";
import { exact, units } from "./math";
import type { PageProps } from "./Home";
export function Setup({ r, s, reload }: PageProps) {
  const { address } = useAccount();
  const [launchNumber, setLaunchNumber] = useState(""),
    [module, setModule] = useState("LpGovernor"),
    [code, setCode] = useState(""),
    [codeError, setCodeError] = useState("");
  if (!s) return null;
  const project = same(address, s.projectWallet);
  const needsSetup =
    !s.registered || !s.split || Object.values(s.moduleReady).some((v) => !v);
  const knownLaunch = launchNumber || s.launchNumber?.toString() || "";
  function launch() {
    if (
      !/^\d+$/.test(knownLaunch) ||
      BigInt(knownLaunch) > 18446744073709551615n
    )
      throw Error("Enter the launch number from the factory’s launch record.");
    return BigInt(knownLaunch);
  }
  return (
    <Panel title="Launch setup">
      <p>
        {needsSetup
          ? "Some launch steps are incomplete. Complete them in order with the appropriate wallet."
          : "Registration, genesis split and all modules are complete."}
      </p>
      <dl>
        <div>
          <dt>Registration</dt>
          <dd>{s.registered ? "Complete" : "Not configured"}</dd>
        </div>
        <div>
          <dt>Genesis split</dt>
          <dd>
            {s.split ? "Complete" : "Pending"} · Splitter holds{" "}
            {units(s.splitterBalance)} NOTSTOCK
          </dd>
        </div>
        {["LpGovernor", "PriceGuard", "VenueV3", "VenueV4"].map((name) => (
          <div key={name}>
            <dt>{name}</dt>
            <dd>{s.moduleReady[name] ? "Deployed" : "Not deployed"}</dd>
          </div>
        ))}
      </dl>
      <details>
        <summary>Claim pool fees</summary>
        <p>
          Ask the launch factory to transfer accrued pool fees to the registered
          FirmVault, then distribute them from Home.
        </p>
        <Field
          label="Factory launch number for fees"
          value={knownLaunch}
          onChange={setLaunchNumber}
          inputMode="numeric"
        />
        <TxButton
          r={r}
          s={s}
          reload={reload}
          label="Claim pool fees"
          disabled={!s.registered}
          prepare={() => ({
            address: s.launchFactory,
            abi: factoryAbi,
            functionName: "claimFees",
            args: [launch()],
            summary: `Claim accrued pool fees for launch #${launch()} to its registered recipient. Distribute the received tokens from Home in a separate transaction.`,
          })}
        />
      </details>
      {needsSetup && (
        <details>
          <summary>Complete setup</summary>
          <p>
            Anyone may deploy a module from its exact pinned creation code. The
            desk verifies the code hash. No private keys are needed.
          </p>
          <label>
            Module
            <select
              value={module}
              onChange={(e) => {
                setModule(e.target.value);
                setCode("");
              }}
            >
              {["LpGovernor", "PriceGuard", "VenueV3", "VenueV4"].map(
                (name) => (
                  <option key={name} disabled={s.moduleReady[name]}>
                    {name}
                  </option>
                ),
              )}
            </select>
          </label>
          <label>
            Creation-code file (.hex or Foundry JSON)
            <input
              type="file"
              accept=".hex,.json,.txt"
              onChange={async (e) => {
                setCodeError("");
                try {
                  const text =
                    (await e.target.files?.[0]?.text())?.trim() ?? "";
                  let value = text;
                  if (text.startsWith("{")) {
                    const parsed = JSON.parse(text);
                    value = parsed.bytecode?.object ?? parsed.bytecode;
                  }
                  if (!/^0x[0-9a-f]+$/i.test(value) || value.length % 2)
                    throw Error(
                      "Choose a hex creation-code file or a Foundry artifact with bytecode.object.",
                    );
                  setCode(value);
                } catch (err) {
                  setCode("");
                  setCodeError((err as Error).message);
                }
              }}
            />
          </label>
          {codeError && <p className="error">{codeError}</p>}
          <TxButton
            r={r}
            s={s}
            reload={reload}
            label="Deploy module"
            disabled={!code || !!s.moduleReady[module]}
            prepare={async () => {
              const kind = stringToHex(module, { size: 32 });
              const expected = await r.client.readContract({
                address: contract(r, "LpDesk"),
                abi: r.abis.LpDesk,
                functionName: "moduleCodeHash",
                args: [kind],
              });
              if (keccak256(code as Hex) !== expected)
                throw Error(
                  "This creation code does not match the desk’s pinned module hash. Use the deployed source build.",
                );
              return {
                address: contract(r, "LpDesk"),
                abi: r.abis.LpDesk,
                functionName: "deployModule",
                args: [kind, code],
                summary: `Deploy the desk’s hash-pinned ${module} module via CREATE2. The contract checks its creation-code hash.`,
              };
            }}
          />
          {!s.registered && (
            <>
              <Field
                label="Factory launch number"
                value={launchNumber}
                onChange={setLaunchNumber}
                inputMode="numeric"
                hint="Use this launch’s number from the factory record. No number is prefilled."
              />
              {project ? (
                <>
                  <TxButton
                    r={r}
                    s={s}
                    reload={reload}
                    label="Fund GenesisSplitter"
                    disabled={s.splitterBalance >= 600000000n * 10n ** 18n}
                    prepare={async () => {
                      const balance = (await r.client.readContract({
                        address: contract(r, "LaunchToken"),
                        abi: r.abis.LaunchToken,
                        functionName: "balanceOf",
                        args: [address!],
                      })) as bigint;
                      const required = 600000000n * 10n ** 18n;
                      if (balance < required)
                        throw Error(
                          "The project wallet needs exactly 600,000,000 NOTSTOCK available for this transfer.",
                        );
                      return {
                        address: contract(r, "LaunchToken"),
                        abi: r.abis.LaunchToken,
                        functionName: "transfer",
                        args: [contract(r, "GenesisSplitter"), required],
                        summary:
                          "Transfer exactly 600,000,000 NOTSTOCK from the project wallet to GenesisSplitter for the fixed genesis allocation.",
                      };
                    }}
                  />
                  <TxButton
                    r={r}
                    s={s}
                    reload={reload}
                    label="Set vault as fee recipient"
                    prepare={() => ({
                      address: s.launchFactory,
                      abi: factoryAbi,
                      functionName: "setRequester",
                      args: [launch(), contract(r, "FirmVault")],
                      summary: `Set FirmVault as the fee recipient for factory launch #${launch()}. Only the project wallet may perform this setup.`,
                    })}
                  />
                </>
              ) : (
                <p>
                  Connect the project wallet to fund GenesisSplitter and set
                  FirmVault as the factory’s fee recipient.{" "}
                  <AddressLink r={r} address={s.projectWallet} />
                </p>
              )}
              <TxButton
                r={r}
                s={s}
                reload={reload}
                label="Register NOTSTOCK"
                disabled={
                  !s.moduleReady.PriceGuard ||
                  s.splitterBalance < 600000000n * 10n ** 18n
                }
                prepare={() => ({
                  address: s.priceGuard,
                  abi: r.abis.PriceGuard,
                  functionName: "registerNotStock",
                  args: [launch()],
                  summary: `Register factory launch #${launch()} against the exact token, pool, fee recipient and genesis allocation. This starts the 7-day bootstrap window.`,
                })}
              />
            </>
          )}
          {!s.split && (
            <TxButton
              r={r}
              s={s}
              reload={reload}
              label="Split genesis allocation"
              disabled={!s.registered || s.splitterBalance === 0n}
              prepare={() => ({
                address: contract(r, "GenesisSplitter"),
                abi: r.abis.GenesisSplitter,
                functionName: "split",
                summary: `Split ${exact(s.splitterBalance)} NOTSTOCK once: 50/60 to LpDesk and 10/60 to the dev wallet. A 600,000,000 allocation sends 500,000,000 to the desk and 100,000,000 to the dev wallet.`,
              })}
            />
          )}
        </details>
      )}
    </Panel>
  );
}
