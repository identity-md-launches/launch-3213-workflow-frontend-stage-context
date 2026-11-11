// Read-only remote fork; every state change below goes exclusively to local Anvil.
import { spawn, execFileSync } from "node:child_process";
import { createServer } from "node:http";
import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  keccak256,
  stringToHex,
  parseAbi,
  toHex,
} from "viem";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import { snapshot } from "../src/data.ts";
const root = fileURLToPath(new URL("../../", import.meta.url));
const handoff = JSON.parse(
  await readFile(root + "web/deployment/handoff.json"),
);
const { network, walletAddChain } = JSON.parse(
  await readFile(root + "web/deployment/network.json"),
);
execFileSync(
  "forge",
  [
    "build",
    "--out",
    "test/scratch/foundry-out",
    "--cache-path",
    "test/scratch/foundry-cache",
    "--quiet",
  ],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);
execFileSync(
  "forge",
  [
    "build",
    "web/tests/fixtures/ForkVenue.sol",
    "--out",
    "test/scratch/foundry-out",
    "--cache-path",
    "test/scratch/foundry-cache",
    "--quiet",
  ],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);
const abis = {};
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
  abis[name] = JSON.parse(await readFile(root + `web/public/abi/${name}.json`));
const contract = (name) =>
  handoff.contracts.find((c) => c.name === name).address;
const chain = defineChain({
  id: handoff.chainId,
  name: network.name,
  nativeCurrency: network.nativeCurrency,
  rpcUrls: { default: { http: network.rpcUrls } },
});
const remote = createPublicClient({
  chain,
  transport: http(network.rpcUrls[0], { timeout: 30000, retryCount: 0 }),
});
const forkBlock = await remote.getBlockNumber();
const portProbe = createServer();
await new Promise((resolve) => portProbe.listen(0, "127.0.0.1", resolve));
const port = portProbe.address().port;
await new Promise((resolve) => portProbe.close(resolve));
const anvil = spawn(
  "anvil",
  [
    "--host",
    "127.0.0.1",
    "--port",
    String(port),
    "--accounts",
    "0",
    "--auto-impersonate",
    "--no-storage-caching",
    "--fork-url",
    network.rpcUrls[0],
    "--fork-block-number",
    forkBlock.toString(),
    "--silent",
  ],
  { cwd: root, stdio: ["ignore", "pipe", "pipe"] },
);
let logs = "";
anvil.stdout.on("data", (s) => (logs += s));
anvil.stderr.on("data", (s) => (logs += s));
const url = `http://127.0.0.1:${port}`;
let rpcId = 0;
async function rpc(method, params = []) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: ++rpcId, method, params }),
  });
  const json = await res.json();
  if (json.error) throw Error(json.error.message);
  return json.result;
}
let browser, server;
try {
  let ready = false;
  for (let attempt = 0; attempt < 150; attempt++) {
    if (anvil.exitCode !== null)
      throw Error("Anvil exited: " + logs.slice(-1200));
    try {
      await rpc("eth_chainId");
      ready = true;
      break;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 200));
    }
  }
  if (!ready) throw Error("Local fork startup timed out.");
  const client = createPublicClient({
    chain,
    transport: http(url, { timeout: 30000, retryCount: 0, batch: { wait: 5 } }),
  });
  const read = (address, abi, functionName, args = []) =>
    client.readContract({ address, abi, functionName, args });
  const desk = contract("LpDesk"),
    token = contract("LaunchToken");
  const account = await read(desk, abis.LpDesk, "projectWallet");
  await rpc("anvil_setBalance", [account, toHex(10n ** 20n)]);
  const wallet = createWalletClient({
    account,
    chain,
    transport: http(url, { timeout: 30000 }),
  });
  async function write(address, abi, functionName, args = []) {
    const sim = await client.simulateContract({
      address,
      abi,
      functionName,
      args,
      account,
    });
    const hash = await wallet.writeContract(sim.request);
    const receipt = await client.waitForTransactionReceipt({ hash });
    assert.equal(receipt.status, "success");
    return hash;
  }
  const moduleTxs = [];
  for (const name of ["LpGovernor", "PriceGuard", "VenueV3", "VenueV4"]) {
    const kind = stringToHex(name, { size: 32 });
    if (!(await read(desk, abis.LpDesk, "isModuleDeployed", [kind]))) {
      const artifact = JSON.parse(
        await readFile(
          root + `test/scratch/foundry-out/${name}.sol/${name}.json`,
        ),
      );
      assert.equal(
        keccak256(artifact.bytecode.object),
        await read(desk, abis.LpDesk, "moduleCodeHash", [kind]),
      );
      moduleTxs.push(
        await write(desk, abis.LpDesk, "deployModule", [
          kind,
          artifact.bytecode.object,
        ]),
      );
    }
  }
  const guard = await read(desk, abis.LpDesk, "priceGuard"),
    governor = await read(desk, abis.LpDesk, "lpGovernor");
  const before = await read(guard, abis.PriceGuard, "venues");
  const factory = before.find((v) => v.kind === 1).factory;
  const weth = await read(guard, abis.PriceGuard, "WETH");
  const fixture = JSON.parse(
    await readFile(
      root + "test/scratch/foundry-out/ForkVenue.sol/ForkVenue.json",
    ),
  );
  const deployed = await wallet.deployContract({
    abi: fixture.abi,
    bytecode: fixture.bytecode.object,
    args: [factory, weth],
  });
  const fixtureReceipt = await client.waitForTransactionReceipt({
    hash: deployed,
  });
  const manager = fixtureReceipt.contractAddress;
  assert(manager);
  const balance = await read(token, abis.LaunchToken, "balanceOf", [account]);
  const stake = 1000n * 10n ** 18n;
  assert(balance >= stake, "Project wallet has no available fork stake.");
  await write(token, abis.LaunchToken, "approve", [governor, stake]);
  await write(governor, abis.LpGovernor, "stake", [stake]);
  await rpc("anvil_mine", ["0x1"]);
  const proposalId = await read(governor, abis.LpGovernor, "proposalCount");
  const proposeHash = await write(
    governor,
    abis.LpGovernor,
    "proposeAddVenue",
    [manager, 1],
  );
  await write(governor, abis.LpGovernor, "vote", [proposalId, true]);
  await rpc("evm_increaseTime", [5 * 86400 + 1]);
  await rpc("anvil_mine", ["0x1"]);
  assert.equal(await read(governor, abis.LpGovernor, "state", [proposalId]), 3);
  const executeHash = await write(governor, abis.LpGovernor, "execute", [
    proposalId,
  ]);
  const after = await read(guard, abis.PriceGuard, "venues");
  assert.equal(after.length, before.length + 1);
  assert.equal(after.at(-1).manager.toLowerCase(), manager.toLowerCase());
  const runtime = {
    deployment: { ...handoff, network, walletAddChain },
    abis,
    chain,
    client,
    fromBlock: BigInt(handoff.contracts[0].blockNumber),
  };
  const state = await snapshot(runtime, account);
  console.log(
    "Fork snapshot loaded",
    state.venues.length,
    "venues,",
    state.warnings.length,
    "notices",
  );
  server = createServer(async (req, res) => {
    try {
      const p = new URL(req.url, "http://local").pathname;
      if (!p.startsWith("/preview/") || p.includes("..")) throw Error();
      const file = p.slice(9) || "index.html";
      const data = await readFile(root + "dist/" + file);
      res.setHeader(
        "Content-Type",
        file.endsWith(".js")
          ? "text/javascript"
          : file.endsWith(".css")
            ? "text/css"
            : file.endsWith(".json")
              ? "application/json"
              : file.endsWith(".svg")
                ? "image/svg+xml"
                : file.endsWith(".png")
                  ? "image/png"
                  : "text/html",
      );
      res.end(data);
    } catch {
      res.writeHead(404).end();
    }
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const base = `http://127.0.0.1:${server.address().port}/preview/`;
  browser = await chromium.launch({
    headless: true,
    args: process.env.IMD_BROWSER_SINGLE_PROCESS
      ? ["--single-process", "--no-zygote", "--disable-gpu"]
      : [],
  });
  const page = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message));
  await page.route("**/*", async (route) => {
    try {
      const req = route.request();
      if (req.url().startsWith(base)) {
        await route.continue();
        return;
      }
      if (network.rpcUrls.some((endpoint) => req.url().startsWith(endpoint))) {
        const response = await fetch(url, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: req.postData(),
        });
        await route.fulfill({
          status: 200,
          contentType: "application/json",
          body: await response.text(),
          headers: { "Access-Control-Allow-Origin": "*" },
        });
        return;
      }
      await route.abort();
    } catch {
      await route.abort().catch(() => {});
    }
  });
  await page.exposeFunction("__forkWalletRequest", async (req) => {
    if (req.method === "eth_sendTransaction")
      throw Error("Signing is disabled in this browser fork check.");
    return rpc(req.method, req.params ?? []);
  });
  const connectedOperator = await read(desk, abis.LpDesk, "operator");
  await page.addInitScript(
    ({ account, chainId }) => {
      const listeners = {};
      let connected = false;
      const provider = {
        on: (e, fn) => (listeners[e] ??= []).push(fn),
        removeListener: (e, fn) => {
          listeners[e] = (listeners[e] ?? []).filter((f) => f !== fn);
        },
        request: async ({ method, params }) => {
          if (method === "eth_accounts") return connected ? [account] : [];
          if (method === "eth_requestAccounts") {
            connected = true;
            return [account];
          }
          if (method === "eth_chainId") return "0x" + chainId.toString(16);
          if (method === "wallet_switchEthereumChain") return null;
          if (method === "wallet_requestPermissions") return [];
          return window.__forkWalletRequest({ method, params });
        },
      };
      window.ethereum = provider;
      const announce = () =>
        dispatchEvent(
          new CustomEvent("eip6963:announceProvider", {
            detail: {
              info: {
                uuid: "684d89fe-7c65-4082-8d23-6281d619bfe3",
                name: "Fork wallet",
                icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
                rdns: "test.identitymd.fork",
              },
              provider,
            },
          }),
        );
      addEventListener("eip6963:requestProvider", announce);
      announce();
    },
    { account: connectedOperator, chainId: chain.id },
  );
  await page.goto(base + "#lp-desk");
  await expect(
    page.getByRole("heading", { name: "Operator overview" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("button", { name: "Fork wallet", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Operator desk", exact: true }),
  ).toBeVisible({ timeout: 30000 });
  await page.getByText("Open a position", { exact: true }).click();
  const venuePicker = page.getByLabel("Venue", { exact: true });
  await expect(venuePicker.locator("option")).toHaveCount(after.length);
  const pickerValues = await venuePicker
    .locator("option")
    .evaluateAll((options) =>
      options.map((option) => option.value.toLowerCase()),
    );
  assert.deepEqual(
    pickerValues,
    after.map((v) => v.manager.toLowerCase()),
  );
  await expect(page.locator(".venue-list .ledger-row")).toHaveCount(
    after.length,
    { timeout: 30000 },
  );
  await expect(page.locator(".venue-list")).toContainText(manager.slice(0, 6), {
    ignoreCase: true,
  });
  assert.deepEqual(errors, []);
  await page.screenshot({
    path: root + "docs/frontend/screenshots/fork-add-venue-1440.png",
    fullPage: true,
  });
  await writeFile(
    root + "docs/frontend/fork-results.json",
    JSON.stringify(
      {
        passed: true,
        remoteWasReadOnly: true,
        chainId: chain.id,
        forkBlock: forkBlock.toString(),
        moduleCodeHashesVerified: true,
        modulesDeployedLocally: moduleTxs.length,
        venuesBefore: before.length,
        venuesAfter: after.length,
        proposalId: proposalId.toString(),
        proposalState: await read(governor, abis.LpGovernor, "state", [
          proposalId,
        ]),
        browserReadLiveVenueCount: after.length,
        operatorPickerMatchesEntireLiveList: true,
        scriptErrors: errors,
        limitations: [
          "All transactions occurred only on the temporary local Anvil fork. No Base transaction was signed or broadcast.",
          "The added manager is a metadata-only test fixture; liquidity operations on it are outside this test.",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(
    "PASS: AddVenue proposed, voted, executed on Base fork; production UI reads the new venue.",
  );
} catch (e) {
  console.error(e.shortMessage ?? e.message);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close().catch(() => {});
  if (server) await new Promise((resolve) => server.close(resolve));
  anvil.kill("SIGTERM");
}
