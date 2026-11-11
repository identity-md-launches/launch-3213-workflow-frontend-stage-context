import { readFile, writeFile } from "node:fs/promises";
import { createPublicClient, defineChain, http } from "viem";
import { snapshot } from "../src/data";
import type { Runtime } from "../src/config";
const handoff = JSON.parse(
  await readFile(
    new URL("../deployment/handoff.json", import.meta.url),
    "utf8",
  ),
);
const { network, walletAddChain } = JSON.parse(
  await readFile(
    new URL("../deployment/network.json", import.meta.url),
    "utf8",
  ),
);
const chain = defineChain({
  id: handoff.chainId,
  name: network.name,
  nativeCurrency: network.nativeCurrency,
  rpcUrls: { default: { http: network.rpcUrls } },
});
const abis: Record<string, any> = {};
for (const name of [
  "LaunchToken",
  "LpDesk",
  "FirmVault",
  "GenesisSplitter",
  "Burner",
  "LpGovernor",
  "PriceGuard",
  "VenueV3",
  "VenueV4",
])
  abis[name] = JSON.parse(
    await readFile(
      new URL(`../public/abi/${name}.json`, import.meta.url),
      "utf8",
    ),
  );
const client = createPublicClient({
  chain,
  transport: http(network.rpcUrls[0], {
    batch: { wait: 20, batchSize: 100 },
    timeout: 15000,
    retryCount: 0,
  }),
});
const r = {
  deployment: { ...handoff, network, walletAddChain },
  abis,
  chain,
  client,
  fromBlock: BigInt(handoff.contracts[0].blockNumber),
} as Runtime;
try {
  const s = await snapshot(r);
  await writeFile(
    new URL("../../docs/frontend/live-read.json", import.meta.url),
    JSON.stringify(
      {
        checkedAt: new Date().toISOString(),
        chainId: await client.getChainId(),
        block: s.block,
        verified: s.verified,
        moduleReady: s.moduleReady,
        registered: s.registered,
        bootstrapEnd: s.bootstrapEnd,
        positionCount: s.positions.length,
        proposalCount: s.proposals.length,
        venues: s.venues,
        tokenCount: s.tokens.length,
        burner: s.burner,
        lpGovernor: s.lpGovernor,
        priceGuard: s.priceGuard,
        warnings: s.warnings,
      },
      (_, v) => (typeof v === "bigint" ? v.toString() : v),
      2,
    ) + "\n",
  );
  console.log(
    "Live snapshot:",
    s.block,
    s.moduleReady,
    s.registered,
    s.warnings,
  );
} catch (e) {
  console.error(e);
  process.exitCode = 1;
}
