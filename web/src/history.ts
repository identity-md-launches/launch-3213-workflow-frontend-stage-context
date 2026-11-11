import { parseAbiItem, type Address } from "viem";
import { contract, erc20Abi, same, type Runtime } from "./config";
import type { Snapshot } from "./types";
export async function pagedLogs(
  r: Runtime,
  filter: any,
  from: bigint,
  to: bigint,
): Promise<any[]> {
  try {
    return await r.client.getLogs({ ...filter, fromBlock: from, toBlock: to });
  } catch (e) {
    if (to - from < 100n) throw e;
    const mid = (from + to) / 2n;
    const first = await pagedLogs(r, filter, from, mid);
    return [...first, ...(await pagedLogs(r, filter, mid + 1n, to))];
  }
}
async function blockAt(r: Runtime, target: bigint, from: bigint, to: bigint) {
  while (from < to) {
    const mid = (from + to + 1n) / 2n;
    const block = await r.client.getBlock({ blockNumber: mid });
    if (block.timestamp <= target) from = mid;
    else to = mid - 1n;
  }
  return from;
}
export async function history(r: Runtime, s: Snapshot) {
  const desk = contract(r, "LpDesk"),
    vault = contract(r, "FirmVault"),
    token = contract(r, "LaunchToken");
  const target = s.time > 604800n ? s.time - 604800n : 0n;
  const launchBlock = await r.client.getBlock({ blockNumber: r.fromBlock });
  const beforeLaunch = target < launchBlock.timestamp;
  const start = beforeLaunch
    ? r.fromBlock
    : await blockAt(r, target, r.fromBlock, s.block);
  const transfer = parseAbiItem(
    "event Transfer(address indexed from,address indexed to,uint256 value)",
  );
  const addresses = s.tokens.map((t) => t.address);
  const [
    received,
    receipts,
    feeEvents,
    buybacks,
    vaultBuybacks,
    bridged,
    oldDead,
  ] = await Promise.all([
    pagedLogs(
      r,
      {
        address: addresses,
        event: transfer,
        args: { from: [desk, vault], to: s.projectWallet },
      },
      r.fromBlock,
      s.block,
    ),
    pagedLogs(
      r,
      {
        address: [token, r.deployment.network.pairToken.address],
        event: transfer,
        args: { to: vault },
      },
      start,
      s.block,
    ),
    pagedLogs(
      r,
      {
        address: desk,
        event: parseAbiItem(
          "event FeesSplit(address indexed token,uint256 collected)",
        ),
      },
      start,
      s.block,
    ),
    pagedLogs(
      r,
      {
        address: desk,
        event: parseAbiItem(
          "event Buyback(uint256 indexed id,uint256 amountIn,uint256 notstockOut)",
        ),
      },
      start,
      s.block,
    ),
    pagedLogs(
      r,
      {
        address: vault,
        event: parseAbiItem(
          "event Buyback(uint256 amountIn,uint256 notstockOut)",
        ),
      },
      start,
      s.block,
    ),
    pagedLogs(
      r,
      {
        address: desk,
        event: parseAbiItem(
          "event BridgedOut(address indexed adapter,uint32 dstEid,address dstLpDesk,uint256 amount)",
        ),
      },
      r.fromBlock,
      s.block,
    ),
    beforeLaunch
      ? 0n
      : r.client.readContract({
          address: token,
          abi: erc20Abi,
          functionName: "balanceOf",
          args: [s.dead],
          blockNumber: start,
        }),
  ]);
  const totals: Record<string, bigint> = {};
  for (const e of received)
    totals[e.address.toLowerCase()] =
      (totals[e.address.toLowerCase()] ?? 0n) + e.args.value;
  const weekly: Record<string, bigint> = {};
  for (const e of receipts)
    if (!same(e.args.from, desk))
      weekly[e.address.toLowerCase()] =
        (weekly[e.address.toLowerCase()] ?? 0n) + e.args.value;
  const lpFees: Record<string, bigint> = {};
  for (const e of feeEvents)
    lpFees[e.args.token.toLowerCase()] =
      (lpFees[e.args.token.toLowerCase()] ?? 0n) + e.args.collected;
  return {
    start,
    end: s.block,
    since: beforeLaunch ? launchBlock.timestamp : target,
    totals,
    weekly,
    lpFees,
    buybacks: [...buybacks, ...vaultBuybacks].sort((a, b) =>
      a.blockNumber < b.blockNumber ? 1 : -1,
    ),
    deadChange: s.deadBalance - oldDead,
    bridged,
  };
}
