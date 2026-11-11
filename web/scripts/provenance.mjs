import { readFile, writeFile, readdir } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { abiHash } from "./integrity.mjs";
const handoff = JSON.parse(
  await readFile(new URL("../deployment/handoff.json", import.meta.url)),
);
const abiHashes = {};
for (const name of await readdir(new URL("../public/abi/", import.meta.url))) {
  const pinned = execFileSync("git", [
    "show",
    `${handoff.sourceCommit}:docs/abi/${name}`,
  ]);
  const delivered = await readFile(
    new URL("../public/abi/" + name, import.meta.url),
  );
  if (!pinned.equals(delivered))
    throw Error("ABI differs from pinned source: " + name);
  abiHashes[name.replace(".json", "")] = abiHash(JSON.parse(delivered));
}
await writeFile(
  new URL("../public/provenance.json", import.meta.url),
  JSON.stringify(
    {
      sourceCommit: handoff.sourceCommit,
      deploymentBlock: Math.min(...handoff.contracts.map((c) => c.blockNumber)),
      abiHashes,
    },
    null,
    2,
  ) + "\n",
);
console.log("All nine ABI exports match the pinned source bytes.");
