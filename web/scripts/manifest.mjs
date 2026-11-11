import { readFile, writeFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { abiHash } from "./integrity.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const handoff = JSON.parse(
  await readFile(root + "web/deployment/handoff.json"),
);
const network = JSON.parse(
  await readFile(root + "web/deployment/network.json"),
);
const contracts = [];
for (const c of handoff.contracts) {
  const abiPath = `abi/${c.name}.json`;
  const abi = JSON.parse(await readFile(root + "dist/" + abiPath));
  if (!Array.isArray(abi) || abiHash(abi) !== c.abiHash)
    throw Error(`ABI hash mismatch: ${c.name}`);
  contracts.push({
    name: c.name,
    address: c.address,
    abiHash: c.abiHash,
    abiPath,
  });
}
async function inventory(dir, prefix = "") {
  const out = [];
  for (const entry of (await readdir(dir, { withFileTypes: true })).sort(
    (a, b) => a.name.localeCompare(b.name),
  )) {
    const path = prefix + entry.name;
    if (entry.isDirectory())
      out.push(...(await inventory(dir + "/" + entry.name, path + "/")));
    else if (path !== "imd-deployment.json") {
      if ((await stat(dir + "/" + entry.name)).size > 8388608)
        throw Error("Asset too large");
      out.push({
        path,
        sha256: createHash("sha256")
          .update(await readFile(dir + "/" + entry.name))
          .digest("hex"),
      });
    }
  }
  return out;
}
const assets = await inventory(root + "dist");
if (assets.length > 128) throw Error("Too many exported files");
const { launchId, chainId, sourceCommit, attestationHash, poolKey } = handoff;
await writeFile(
  root + "dist/imd-deployment.json",
  JSON.stringify(
    {
      version: 1,
      launchId,
      chainId,
      sourceCommit,
      attestationHash,
      contracts,
      assets,
      ...(poolKey ? { poolKey } : {}),
      ...network,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Deployment verified; ${contracts.length} ABI bindings, ${assets.length} hashed assets.`,
);
