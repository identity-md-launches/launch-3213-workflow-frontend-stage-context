import { readFile, readdir, stat } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { abiHash } from "./integrity.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const read = async (p) => JSON.parse(await readFile(root + p, "utf8"));
const manifest = await read("dist/imd-deployment.json"),
  handoff = await read("web/deployment/handoff.json"),
  network = await read("web/deployment/network.json");
assert.deepEqual(
  Object.keys(manifest).sort(),
  [
    "version",
    "launchId",
    "chainId",
    "sourceCommit",
    "attestationHash",
    "contracts",
    "assets",
    "poolKey",
    "network",
    "walletAddChain",
  ].sort(),
);
for (const k of [
  "version",
  "launchId",
  "chainId",
  "sourceCommit",
  "attestationHash",
  "poolKey",
])
  assert.deepEqual(manifest[k], handoff[k], k);
assert.deepEqual(manifest.network, network.network);
assert.deepEqual(manifest.walletAddChain, network.walletAddChain);
assert.deepEqual(
  manifest.contracts.map(({ abiPath, ...c }) => c),
  handoff.contracts.map(({ name, address, abiHash }) => ({
    name,
    address,
    abiHash,
  })),
);
const files = [];
async function walk(dir, prefix = "") {
  for (const item of await readdir(dir, { withFileTypes: true })) {
    const p = prefix + item.name;
    if (item.isDirectory()) {
      assert(
        !["node_modules", ".cache", ".vite", "vendor"].includes(item.name),
      );
      await walk(dir + "/" + item.name, p + "/");
    } else if (p !== "imd-deployment.json") files.push(p);
  }
}
await walk(root + "dist");
assert(files.length <= 128);
assert.deepEqual(manifest.assets.map((a) => a.path).sort(), files.sort());
let bytes = 0;
for (const a of manifest.assets) {
  assert(
    !a.path.startsWith("/") &&
      !a.path.split("/").includes("..") &&
      !a.path.includes("://"),
  );
  assert.match(a.sha256, /^[0-9a-f]{64}$/);
  const file = await readFile(root + "dist/" + a.path);
  assert(file.length <= 8388608);
  bytes += file.length;
  assert.equal(
    createHash("sha256").update(file).digest("hex"),
    a.sha256,
    a.path,
  );
}
for (const c of manifest.contracts) {
  assert.match(c.abiHash, /^[0-9a-f]{64}$/);
  assert.equal(abiHash(await read("dist/" + c.abiPath)), c.abiHash, c.name);
}
assert(bytes < 32 * 1024 * 1024);
const provenance = await read("dist/provenance.json");
for (const [name, hash] of Object.entries(provenance.abiHashes))
  assert.equal(abiHash(await read("dist/abi/" + name + ".json")), hash, name);
const html = await readFile(root + "dist/index.html", "utf8");
for (const marker of [
  "<title>",
  'rel="icon"',
  'name="description"',
  'property="og:title"',
  'property="og:image"',
])
  assert(html.includes(marker), marker);
assert(!html.includes('src="/assets/'));
console.log(
  JSON.stringify(
    {
      valid: true,
      contracts: manifest.contracts.length,
      assets: files.length,
      exportBytes: bytes,
      sourceCommit: manifest.sourceCommit,
    },
    null,
    2,
  ),
);
