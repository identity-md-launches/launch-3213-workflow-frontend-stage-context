import {
  decodeAbiParameters,
  encodeAbiParameters,
  keccak256,
  pad,
  type Address,
  type Abi,
} from "viem";
import {
  contract,
  erc20Abi,
  same,
  stateViewAbi,
  oftAbi,
  type Runtime,
} from "./config";
import { liquidityAmounts } from "./math";
import type {
  Snapshot,
  Position,
  Proposal,
  PositionView,
  Token,
  Venue,
  Bridge,
} from "./types";
export async function snapshot(
  r: Runtime,
  account?: Address,
): Promise<Snapshot> {
  const block = await r.client.getBlock();
  const blockNumber = block.number;
  const read = async (
    address: Address,
    abi: Abi,
    functionName: string,
    args: readonly unknown[] = [],
  ) =>
    r.client.readContract({
      address,
      abi,
      functionName,
      args,
      blockNumber,
    }) as Promise<any>;
  const desk = contract(r, "LpDesk"),
    vault = contract(r, "FirmVault"),
    token = contract(r, "LaunchToken"),
    splitter = contract(r, "GenesisSplitter"),
    imd = r.deployment.network.pairToken.address;
  const d = (fn: string, args: unknown[] = []) =>
      read(desk, r.abis.LpDesk, fn, args),
    v = (fn: string, args: unknown[] = []) =>
      read(vault, r.abis.FirmVault, fn, args);
  const [
    chainId,
    codes,
    operator,
    projectWallet,
    dead,
    launchFactory,
    burner,
    lpGovernor,
    priceGuard,
    venueV3,
    venueV4,
    registered,
    bootstrapEnd,
    bucket,
    undistributedImd,
    undistributedNot,
    split,
    splitterBalance,
    boundToken,
  ] = await Promise.all([
    r.client.getChainId(),
    Promise.all(
      r.deployment.contracts.map((c) =>
        r.client.getBytecode({ address: c.address, blockNumber }),
      ),
    ),
    d("operator"),
    d("projectWallet"),
    d("DEAD"),
    d("launchFactory"),
    d("burner"),
    d("lpGovernor"),
    d("priceGuard"),
    d("venueV3"),
    d("venueV4"),
    d("registered"),
    d("bootstrapEnd"),
    v("buybackBucket"),
    v("undistributed", [imd]),
    v("undistributed", [token]),
    read(splitter, r.abis.GenesisSplitter, "hasSplit"),
    read(token, erc20Abi, "balanceOf", [splitter]),
    d("token"),
  ]);
  if (
    chainId !== r.deployment.chainId ||
    codes.some((c) => !c || c === "0x") ||
    !same(boundToken, token)
  )
    throw Error("Deployment verification failed. Transactions are locked.");
  const moduleEntries = await Promise.all(
    Object.entries({
      Burner: burner,
      LpGovernor: lpGovernor,
      PriceGuard: priceGuard,
      VenueV3: venueV3,
      VenueV4: venueV4,
    }).map(
      async ([name, address]) =>
        [
          name,
          !!(await r.client.getBytecode({
            address: address as Address,
            blockNumber,
          })),
        ] as const,
    ),
  );
  const moduleReady = Object.fromEntries(moduleEntries);
  const warnings: string[] = [];
  const launchNumber =
    registered && moduleReady.PriceGuard
      ? BigInt(await read(priceGuard, r.abis.PriceGuard, "launchNumber"))
      : undefined;
  const g = (fn: string, args: unknown[] = []) =>
    read(lpGovernor, r.abis.LpGovernor, fn, args);
  const [
    burnerBalance,
    deadBalance,
    walletBalance,
    walletImd,
    venues,
    assets,
    totalStaked,
    staked,
    stakeAllowance,
    proposalCount,
    bridges,
  ] = await Promise.all([
    read(token, erc20Abi, "balanceOf", [burner]),
    read(token, erc20Abi, "balanceOf", [dead]),
    account ? read(token, erc20Abi, "balanceOf", [account]) : undefined,
    account ? read(imd, erc20Abi, "balanceOf", [account]) : undefined,
    moduleReady.PriceGuard ? read(priceGuard, r.abis.PriceGuard, "venues") : [],
    moduleReady.PriceGuard
      ? read(priceGuard, r.abis.PriceGuard, "assets")
      : [imd],
    moduleReady.LpGovernor ? g("totalStaked") : undefined,
    account && moduleReady.LpGovernor ? g("staked", [account]) : undefined,
    account && moduleReady.LpGovernor
      ? read(token, erc20Abi, "allowance", [account, lpGovernor])
      : undefined,
    moduleReady.LpGovernor ? g("proposalCount") : 0n,
    moduleReady.LpGovernor ? g("bridges") : [],
  ]);
  const tokenAddresses = [
    token,
    ...(assets as Address[]).filter((a) => !same(a, token)),
  ];
  const tokens: Token[] = await Promise.all(
    tokenAddresses.map(async (address) => {
      const [free, topUp, buyback] = await Promise.all([
        d("freeBalance", [address]).catch((error: unknown) => {
          if (same(address, token) || same(address, imd)) throw error;
          warnings.push(
            `Token balance unavailable: ${address}. Actions using it are locked.`,
          );
          return undefined;
        }),
        d("topUpBasket", [address]),
        d("buybackBasket", [address]),
      ]);
      if (same(address, token))
        return {
          address,
          symbol: "NOTSTOCK",
          decimals: 18,
          free,
          topUp,
          buyback,
          metadataOk: true,
        };
      if (same(address, imd))
        return {
          address,
          symbol: r.deployment.network.pairToken.symbol,
          decimals: r.deployment.network.pairToken.decimals,
          free,
          topUp,
          buyback,
          metadataOk: true,
        };
      try {
        const [symbol, decimals] = await Promise.all([
          read(address, erc20Abi, "symbol"),
          read(address, erc20Abi, "decimals"),
        ]);
        return {
          address,
          symbol,
          decimals,
          free,
          topUp,
          buyback,
          metadataOk: free !== undefined,
        };
      } catch {
        warnings.push(
          `Token metadata unavailable: ${address}. Actions using it are locked.`,
        );
        return {
          address,
          symbol: address,
          decimals: 0,
          free,
          topUp,
          buyback,
          metadataOk: false,
        };
      }
    }),
  );
  const rawPositions: Position[] = await d("positions");
  const positions: PositionView[] = await Promise.all(
    rawPositions.map(async (position, id) => {
      if (!position.open) return { id, position };
      try {
        const module = position.kind === 0 ? venueV4 : venueV3,
          abi = r.abis[position.kind === 0 ? "VenueV4" : "VenueV3"];
        const [liquidity, [sqrtPrice, exists]] = await Promise.all([
          d("positionLiquidity", [BigInt(id)]),
          read(module, abi, "poolPrice", [position]),
        ]);
        if (!exists) throw Error("Position pool is unavailable");
        const [a0, a1] = liquidityAmounts(
          sqrtPrice,
          position.tickLower,
          position.tickUpper,
          liquidity,
        );
        const [notstock, assetAmount] =
          token.toLowerCase() < position.asset.toLowerCase()
            ? [a0, a1]
            : [a1, a0];
        return { id, position, liquidity, sqrtPrice, notstock, assetAmount };
      } catch {
        return {
          id,
          position,
          error:
            "Position valuation unavailable. Refresh before managing this position.",
        };
      }
    }),
  );
  const proposals: Proposal[] = [];
  // Bounded concurrency, but no history truncation: every proposal is read.
  for (let offset = 0; offset < Number(proposalCount); offset += 12) {
    proposals.push(
      ...(await Promise.all(
        Array.from(
          { length: Math.min(12, Number(proposalCount) - offset) },
          async (_, i) => {
            const id = offset + i;
            const p = await g("proposal", [BigInt(id)]);
            const state = await g("state", [BigInt(id)]);
            const [voted, weight] = account
              ? await Promise.all([
                  g("hasVoted", [BigInt(id), account]),
                  g("stakedAt", [account, p.checkpointBlock]),
                ])
              : [false, 0n];
            const proposal: Proposal = { ...p, id, state, voted, weight };
            if (p.kind === 4 && state === 3) {
              try {
                const [bridgeId, amount] = decodeAbiParameters(
                  [{ type: "uint256" }, { type: "uint256" }],
                  p.data,
                );
                const b: Bridge = bridges[Number(bridgeId)];
                if (!b) throw Error("Missing bridge");
                const fee = await read(b.adapter, oftAbi, "quoteSend", [
                  {
                    dstEid: b.dstChainId,
                    to: pad(b.dstLpDesk),
                    amountLD: amount,
                    minAmountLD: amount,
                    extraOptions: "0x",
                    composeMsg: "0x",
                    oftCmd: "0x",
                  },
                  false,
                ]);
                proposal.bridgeFee = fee.nativeFee;
              } catch {
                proposal.feeError =
                  "Bridge fee quote unavailable. Execution is locked.";
              }
            }
            return proposal;
          },
        ),
      )),
    );
  }
  let poolSqrt: bigint | undefined;
  try {
    const id = keccak256(
      encodeAbiParameters(
        [
          {
            type: "tuple",
            components: [
              { type: "address", name: "currency0" },
              { type: "address", name: "currency1" },
              { type: "uint24", name: "fee" },
              { type: "int24", name: "tickSpacing" },
              { type: "address", name: "hooks" },
            ],
          },
        ],
        [r.deployment.poolKey],
      ),
    );
    const slot = await read(
      r.deployment.network.uniswapV4.stateView,
      stateViewAbi,
      "getSlot0",
      [id],
    );
    if (slot[0] > 0n) poolSqrt = slot[0];
  } catch {
    warnings.push(
      "Launch pool price unavailable. Quotes are still simulated independently.",
    );
  }
  for (const [name, ready] of moduleEntries)
    if (!ready)
      warnings.push(
        `${name} has not been deployed. Related actions are unavailable.`,
      );
  return {
    block: blockNumber,
    time: block.timestamp,
    verified: true,
    operator,
    projectWallet,
    dead,
    launchFactory,
    burner,
    lpGovernor,
    priceGuard,
    venueV3,
    venueV4,
    moduleReady,
    registered,
    launchNumber,
    bootstrapEnd,
    bucket,
    undistributedImd,
    undistributedNot,
    burnerBalance,
    deadBalance,
    walletBalance,
    walletImd,
    venues: venues as Venue[],
    totalStaked,
    staked,
    stakeAllowance,
    tokens,
    positions,
    proposals,
    bridges,
    split,
    splitterBalance,
    poolSqrt,
    warnings,
  };
}
