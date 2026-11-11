import { useState } from "react";
import { useAccount } from "wagmi";
import {
  decodeAbiParameters,
  getAddress,
  isAddress,
  pad,
  zeroAddress,
  type Address,
} from "viem";
import { contract, erc20Abi, oftAbi, same } from "./config";
import {
  amount,
  bootstrapActive,
  canPropose,
  checkedAmount,
  exact,
  proposalKinds,
  proposalStates,
  units,
} from "./math";
import {
  AddressLink,
  Empty,
  Field,
  Panel,
  Select,
  Stat,
  TxButton,
  WalletGate,
} from "./ui";
import { PositionEditor } from "./PositionEditor";
import type { PageProps } from "./Home";
import type { Proposal } from "./types";
export const validAddress = (value: string) => {
  const v = value.trim();
  if (!isAddress(v) || same(v, zeroAddress))
    throw Error("Enter a valid, nonzero contract address.");
  return getAddress(v);
};
export const date = (timestamp: bigint) =>
  new Date(Number(timestamp) * 1000).toLocaleString();
export function timeLeft(timestamp: bigint, now: bigint) {
  const n = Number(timestamp - now);
  if (n <= 0) return "ended";
  const days = Math.floor(n / 86400),
    hours = Math.floor((n % 86400) / 3600),
    minutes = Math.floor((n % 3600) / 60);
  return days
    ? `${days}d ${hours}h left`
    : hours
      ? `${hours}h ${minutes}m left`
      : `${Math.max(1, minutes)}m left`;
}
export function Staking({ r, s, reload }: PageProps) {
  const { address } = useAccount();
  const [stake, setStake] = useState(""),
    [unstake, setUnstake] = useState("");
  const enough = (() => {
    try {
      return !!s && !!stake && (s.stakeAllowance ?? 0n) >= amount(stake, 18);
    } catch {
      return false;
    }
  })();
  return (
    <Panel title="A stake in the decisions">
      <div className="metrics staking-metrics">
        <Stat label="Your stake" value={units(s?.staked)} unit="NOTSTOCK" />
        <Stat
          label="All staked"
          value={units(s?.totalStaked)}
          unit="NOTSTOCK"
        />
      </div>
      <p className="muted">
        Voting weight is recorded at the block before each proposal. Tokens stay
        in LpGovernor; you can unstake at any time.
      </p>
      <WalletGate r={r} s={s} />
      <div className="two-columns">
        <div>
          <div className="amount-head">
            <span>Wallet: {units(s?.walletBalance)}</span>
            <button
              disabled={s?.walletBalance === undefined}
              onClick={() => setStake(exact(s!.walletBalance!))}
            >
              Max
            </button>
          </div>
          <Field
            label="NOTSTOCK to stake"
            value={stake}
            onChange={setStake}
            inputMode="decimal"
          />
          {enough ? (
            <TxButton
              r={r}
              s={s}
              reload={reload}
              label="Stake NOTSTOCK"
              disabled={!s?.moduleReady.LpGovernor}
              prepare={async () => {
                const balance = await r.client.readContract({
                  address: contract(r, "LaunchToken"),
                  abi: erc20Abi,
                  functionName: "balanceOf",
                  args: [address!],
                });
                const n = checkedAmount(stake, 18, balance, "NOTSTOCK");
                return {
                  address: s!.lpGovernor,
                  abi: r.abis.LpGovernor,
                  functionName: "stake",
                  args: [n],
                  summary: `Stake ${stake} NOTSTOCK for governance. This is token staking, not position or NFT staking.`,
                };
              }}
            />
          ) : (
            <TxButton
              r={r}
              s={s}
              reload={reload}
              label="Approve NOTSTOCK for staking"
              disabled={!stake || !s?.moduleReady.LpGovernor}
              prepare={() => {
                const n = checkedAmount(
                  stake,
                  18,
                  s!.walletBalance!,
                  "NOTSTOCK",
                );
                return {
                  address: contract(r, "LaunchToken"),
                  abi: r.abis.LaunchToken,
                  functionName: "approve",
                  args: [s!.lpGovernor, n],
                  summary: `Approve LpGovernor to transfer exactly ${stake} NOTSTOCK. Stake is a separate transaction.`,
                };
              }}
            />
          )}
        </div>
        <div>
          <div className="amount-head">
            <span>Staked: {units(s?.staked)}</span>
            <button
              disabled={s?.staked === undefined}
              onClick={() => setUnstake(exact(s!.staked!))}
            >
              Max
            </button>
          </div>
          <Field
            label="NOTSTOCK to unstake"
            value={unstake}
            onChange={setUnstake}
            inputMode="decimal"
          />
          <TxButton
            r={r}
            s={s}
            reload={reload}
            label="Unstake NOTSTOCK"
            disabled={!unstake || !s?.moduleReady.LpGovernor}
            prepare={() => ({
              address: s!.lpGovernor,
              abi: r.abis.LpGovernor,
              functionName: "unstake",
              args: [checkedAmount(unstake, 18, s!.staked!, "staked NOTSTOCK")],
              summary: `Return ${unstake} staked NOTSTOCK to your wallet. Existing proposal checkpoints retain their recorded voting weight.`,
            })}
          />
        </div>
      </div>
    </Panel>
  );
}
export function ProposalForm(props: PageProps) {
  const { r, s, reload } = props;
  const { address } = useAccount();
  const operator = same(address, s?.operator),
    eligible = !!s && canPropose(s.staked ?? 0n, s.totalStaked ?? 0n, operator);
  const [kind, setKind] = useState("2"),
    [asset, setAsset] = useState(""),
    [manager, setManager] = useState(""),
    [venueKind, setVenueKind] = useState("1"),
    [adapter, setAdapter] = useState(""),
    [destination, setDestination] = useState(""),
    [desk, setDesk] = useState(""),
    [bridge, setBridge] = useState("0"),
    [value, setValue] = useState("");
  const bootstrap = !!s && bootstrapActive(s.bootstrapEnd, s.time);
  return (
    <Panel title="Propose the next move">
      <p>
        Proposing needs at least 0.1% of all staked NOTSTOCK. The operator may
        propose without staking. Each proposal has a 3-day vote, a 3% quorum and
        a 2-day operator veto window, followed by 3 days to execute.
      </p>
      {!eligible && (
        <p className="hint">
          {address
            ? "Stake more NOTSTOCK to propose."
            : "Connect and stake to propose."}{" "}
          Current threshold:{" "}
          {s?.totalStaked !== undefined
            ? units((s.totalStaked + 999n) / 1000n)
            : "Unavailable"}{" "}
          NOTSTOCK.
        </p>
      )}
      <Select label="Proposal kind" value={kind} onChange={setKind}>
        <option value="0" disabled={bootstrap}>
          Open position{bootstrap ? " (after bootstrap)" : ""}
        </option>
        <option value="1" disabled={bootstrap}>
          Add asset{bootstrap ? " (after bootstrap)" : ""}
        </option>
        <option value="2">Add venue</option>
        <option value="3">Add bridge</option>
        <option value="4">Bridge out</option>
      </Select>
      {kind === "0" ? (
        eligible && !bootstrap ? (
          <PositionEditor {...props} proposal />
        ) : (
          <Empty>
            New position proposals are available to eligible wallets after
            bootstrap.
          </Empty>
        )
      ) : (
        <>
          <div className="form-grid">
            {kind === "1" && (
              <Field
                label="Asset contract address"
                value={asset}
                onChange={setAsset}
              />
            )}{" "}
            {kind === "2" && (
              <>
                <Field
                  label="Position manager address"
                  value={manager}
                  onChange={setManager}
                />
                <Select
                  label="Venue kind"
                  value={venueKind}
                  onChange={setVenueKind}
                >
                  <option value="0">V4</option>
                  <option value="1">V3</option>
                  <option value="2">CL</option>
                </Select>
              </>
            )}
            {kind === "3" && (
              <>
                <Field
                  label="OFT adapter address"
                  value={adapter}
                  onChange={setAdapter}
                />
                <Field
                  label="Destination chain ID (LayerZero endpoint ID)"
                  value={destination}
                  onChange={setDestination}
                  inputMode="numeric"
                />
                <Field
                  label="Destination LpDesk address"
                  value={desk}
                  onChange={setDesk}
                />
              </>
            )}
            {kind === "4" && (
              <>
                <Select
                  label="Registered bridge"
                  value={bridge}
                  onChange={setBridge}
                >
                  {s?.bridges.map((b, i) => (
                    <option key={i} value={i}>
                      #{i} · Chain {b.dstChainId} · {b.adapter}
                    </option>
                  ))}
                </Select>
                <Field
                  label="NOTSTOCK amount to bridge"
                  value={value}
                  onChange={setValue}
                  inputMode="decimal"
                  hint="Use increments of 0.000001 NOTSTOCK. The executing wallet pays the LayerZero fee."
                />
              </>
            )}
          </div>
          <TxButton
            r={r}
            s={s}
            reload={reload}
            label={`Propose ${proposalKinds[Number(kind)].toLowerCase()}`}
            disabled={
              !eligible ||
              !s?.moduleReady.LpGovernor ||
              (bootstrap && kind === "1") ||
              (kind === "4" && !s?.bridges.length)
            }
            prepare={() => {
              let functionName = "",
                args: unknown[] = [];
              if (kind === "1") {
                functionName = "proposeAddAsset";
                args = [validAddress(asset)];
              } else if (kind === "2") {
                functionName = "proposeAddVenue";
                args = [validAddress(manager), Number(venueKind)];
              } else if (kind === "3") {
                const chain = Number(destination);
                if (
                  !/^\d+$/.test(destination) ||
                  !Number.isInteger(chain) ||
                  chain <= 0 ||
                  chain > 4294967295
                )
                  throw Error(
                    "Enter a valid LayerZero destination endpoint ID.",
                  );
                functionName = "proposeAddBridge";
                args = [validAddress(adapter), chain, validAddress(desk)];
              } else {
                const n = checkedAmount(
                  value,
                  18,
                  s!.tokens.find((t) =>
                    same(t.address, contract(r, "LaunchToken")),
                  )!.free,
                  "desk free NOTSTOCK",
                );
                if (n % 1000000000000n)
                  throw Error(
                    "Use an amount in increments of 0.000001 NOTSTOCK.",
                  );
                functionName = "proposeBridgeOut";
                args = [BigInt(bridge), n];
              }
              return {
                address: s!.lpGovernor,
                abi: r.abis.LpGovernor,
                functionName,
                args,
                summary: `Submit a ${proposalKinds[Number(kind)].toLowerCase()} proposal. This does not execute the change; it opens the vote, veto and execution windows.`,
              };
            }}
          />
        </>
      )}
    </Panel>
  );
}
function ProposalData({ p, r }: { p: Proposal; r: PageProps["r"] }) {
  try {
    const name = [
      "proposeOpenPosition",
      "proposeAddAsset",
      "proposeAddVenue",
      "proposeAddBridge",
      "proposeBridgeOut",
    ][p.kind];
    const fn = r.abis.LpGovernor.find(
      (i) => i.type === "function" && i.name === name,
    );
    if (!fn || fn.type !== "function") return null;
    const data = decodeAbiParameters(fn.inputs, p.data);
    return (
      <details>
        <summary>Proposed change</summary>
        <pre>
          {JSON.stringify(
            data,
            (_, v) => (typeof v === "bigint" ? v.toString() : v),
            2,
          )}
        </pre>
      </details>
    );
  } catch {
    return <p className="warning">Unable to decode proposal data.</p>;
  }
}
export function Proposals({ r, s, reload }: PageProps) {
  const { address } = useAccount();
  const operator = same(address, s?.operator);
  return (
    <Panel title="Every proposal">
      {!s ? (
        <Empty>Reading governance history.</Empty>
      ) : !s.moduleReady.LpGovernor ? (
        <Empty>
          LpGovernor is not deployed. Governance opens after launch setup.
        </Empty>
      ) : !s.proposals.length ? (
        <Empty>
          No proposals yet. Stake NOTSTOCK to help decide the desk’s next move.
        </Empty>
      ) : (
        <div className="proposals">
          {[...s.proposals].reverse().map((p) => {
            const participation = p.forWeight + p.againstWeight,
              quorum = (p.quorumBase * 300n + 9999n) / 10000n;
            const expired =
              p.state === 4 || (p.state === 3 && s.time >= p.expiry);
            return (
              <article className="proposal" key={p.id}>
                <div className="section-head">
                  <h3>
                    #{p.id} · {proposalKinds[p.kind]}
                  </h3>
                  <span className="pill">
                    {expired ? "Expired" : proposalStates[p.state]}
                  </span>
                </div>
                <AddressLink
                  r={r}
                  address={p.author}
                  label={p.byOperator ? "Operator proposal" : "Proposer"}
                />
                <div className="vote-weights">
                  <span>
                    For <strong>{units(p.forWeight)}</strong>
                  </span>
                  <span>
                    Against <strong>{units(p.againstWeight)}</strong>
                  </span>
                  <span>
                    Quorum{" "}
                    <strong>
                      {units(participation)} / {units(quorum)}
                    </strong>
                  </span>
                </div>
                <progress
                  aria-label={`Proposal ${p.id} quorum progress`}
                  max="100"
                  value={
                    quorum > 0n
                      ? Math.min(
                          100,
                          Number((participation * 10000n) / quorum) / 100,
                        )
                      : 0
                  }
                />
                <dl className="deadlines">
                  <div>
                    <dt>Vote ends</dt>
                    <dd>{date(p.voteEnd)}</dd>
                  </div>
                  <div>
                    <dt>Veto ends</dt>
                    <dd>{date(p.vetoEnd)}</dd>
                  </div>
                  <div>
                    <dt>Execution expires</dt>
                    <dd>
                      {date(p.expiry)}
                      {(p.state === 2 || p.state === 3) && !expired && (
                        <strong> · {timeLeft(p.expiry, s.time)}</strong>
                      )}
                    </dd>
                  </div>
                </dl>
                <ProposalData p={p} r={r} />
                <div className="action-row">
                  {p.state === 0 && (
                    <>
                      <TxButton
                        r={r}
                        s={s}
                        reload={reload}
                        label="Vote for"
                        disabled={p.voted || p.weight === 0n}
                        prepare={() => ({
                          address: s.lpGovernor,
                          abi: r.abis.LpGovernor,
                          functionName: "vote",
                          args: [BigInt(p.id), true],
                          summary: `Vote for proposal #${p.id} with checkpoint weight ${exact(p.weight)} NOTSTOCK. Each wallet may vote once.`,
                        })}
                      />
                      <TxButton
                        r={r}
                        s={s}
                        reload={reload}
                        label="Vote against"
                        disabled={p.voted || p.weight === 0n}
                        prepare={() => ({
                          address: s.lpGovernor,
                          abi: r.abis.LpGovernor,
                          functionName: "vote",
                          args: [BigInt(p.id), false],
                          summary: `Vote against proposal #${p.id} with checkpoint weight ${exact(p.weight)} NOTSTOCK. Each wallet may vote once.`,
                        })}
                      />
                      {p.voted ? (
                        <span>Vote recorded.</span>
                      ) : p.weight === 0n && address ? (
                        <span>No stake at this proposal’s checkpoint.</span>
                      ) : null}
                    </>
                  )}
                  {p.state === 2 && operator && (
                    <TxButton
                      r={r}
                      s={s}
                      reload={reload}
                      operator
                      label="Veto proposal"
                      prepare={() => ({
                        address: s.lpGovernor,
                        abi: r.abis.LpGovernor,
                        functionName: "veto",
                        args: [BigInt(p.id)],
                        summary: `Permanently veto proposal #${p.id}. It will no longer be executable.`,
                      })}
                    />
                  )}{" "}
                  {p.state === 3 && !expired && (
                    <>
                      {p.kind === 4 && (
                        <p>
                          {p.bridgeFee !== undefined
                            ? `LayerZero fee paid by executing wallet: ${exact(p.bridgeFee)} ETH`
                            : p.feeError}
                        </p>
                      )}
                      <TxButton
                        r={r}
                        s={s}
                        reload={reload}
                        label="Execute proposal"
                        disabled={p.kind === 4 && p.bridgeFee === undefined}
                        prepare={async () => {
                          let fee = 0n;
                          if (p.kind === 4) {
                            const [id, n] = decodeAbiParameters(
                              [{ type: "uint256" }, { type: "uint256" }],
                              p.data,
                            );
                            const b = s.bridges[Number(id)];
                            const q = await r.client.readContract({
                              address: b.adapter,
                              abi: oftAbi,
                              functionName: "quoteSend",
                              args: [
                                {
                                  dstEid: b.dstChainId,
                                  to: pad(b.dstLpDesk),
                                  amountLD: n,
                                  minAmountLD: n,
                                  extraOptions: "0x",
                                  composeMsg: "0x",
                                  oftCmd: "0x",
                                },
                                false,
                              ],
                            });
                            fee = q.nativeFee;
                          }
                          return {
                            address: s.lpGovernor,
                            abi: r.abis.LpGovernor,
                            functionName: "execute",
                            args: [BigInt(p.id)],
                            value: fee,
                            summary: `Execute proposal #${p.id}: ${proposalKinds[p.kind]}.${p.kind === 4 ? ` Your wallet pays ${exact(fee)} ETH in LayerZero fees, plus gas.` : ""}`,
                          };
                        }}
                      />
                    </>
                  )}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </Panel>
  );
}
