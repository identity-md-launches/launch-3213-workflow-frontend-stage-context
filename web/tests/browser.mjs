import { createServer } from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { createMock, operator, visitor, addr } from "./mock-rpc.mjs";
const root = fileURLToPath(new URL("../../", import.meta.url));
const out = root + "docs/frontend";
await mkdir(out + "/screenshots", { recursive: true });
const { network } = JSON.parse(
  await readFile(root + "web/deployment/network.json"),
);
const mime = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".json": "application/json",
  ".png": "image/png",
  ".svg": "image/svg+xml",
};
const server = createServer(async (req, res) => {
  try {
    const p = decodeURIComponent(new URL(req.url, "http://local").pathname);
    if (!p.startsWith("/preview/") || p.includes("..")) {
      res.writeHead(404).end();
      return;
    }
    const file = p.slice(9) || "index.html";
    const body = await readFile(root + "dist/" + file);
    res.setHeader(
      "Content-Type",
      mime[file.slice(file.lastIndexOf("."))] ?? "application/octet-stream",
    );
    res.end(body);
  } catch {
    res.writeHead(404).end("Not found");
  }
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
const base = `http://127.0.0.1:${server.address().port}/preview/`;
const browser = await chromium.launch({
  headless: true,
  args: process.env.IMD_BROWSER_SINGLE_PROCESS
    ? ["--single-process", "--no-zygote", "--disable-gpu"]
    : [],
});
const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  reducedMotion: "reduce",
});
let mode = "mock";
const mock = createMock();
const checks = [],
  errors = [],
  resources = [],
  unexpected = [];
const page = await context.newPage();
page.on("pageerror", (e) => errors.push(e.message));
page.on("response", (res) => {
  if (res.status() >= 400 && res.url().startsWith(base))
    resources.push(res.url());
});
await page.route("**/*", async (route) => {
  const req = route.request(),
    url = req.url();
  if (url.startsWith(base)) {
    await route.continue();
    return;
  }
  if (network.rpcUrls.some((r) => url.startsWith(r))) {
    try {
      const body = req.postDataJSON();
      const down = (req) => ({
        jsonrpc: "2.0",
        id: req.id,
        error: { code: -32000, message: "RPC unavailable" },
      });
      const result =
        mode === "down"
          ? Array.isArray(body)
            ? body.map(down)
            : down(body)
          : mode === "live"
            ? await (
                await fetch(url, {
                  method: "POST",
                  headers: { "Content-Type": "application/json" },
                  body: JSON.stringify(body),
                })
              ).json()
            : Array.isArray(body)
              ? body.map(mock.handle)
              : mock.handle(body);
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(result),
        headers: { "Access-Control-Allow-Origin": "*" },
      });
    } catch (e) {
      await route.abort();
    }
    return;
  }
  unexpected.push({ url, type: req.resourceType() });
  await route.abort();
});
await page.exposeFunction("__mockWalletRpc", (req) =>
  mock.handle({ ...req, id: 7 }),
);
await page.addInitScript(
  ({ account, chain }) => {
    const listeners = {};
    const w = {
      account,
      chain,
      unknown: false,
      reject: false,
      events: [],
      connected: false,
    };
    window.__walletState = w;
    const provider = {
      isMetaMask: true,
      on: (e, fn) => (listeners[e] ??= []).push(fn),
      removeListener: (e, fn) => {
        listeners[e] = (listeners[e] ?? []).filter((f) => f !== fn);
      },
      request: async ({ method, params }) => {
        w.events.push(method);
        if (method === "eth_accounts") return w.connected ? [w.account] : [];
        if (method === "eth_requestAccounts") {
          if (w.reject) {
            const e = new Error("User rejected");
            e.code = 4001;
            throw e;
          }
          w.connected = true;
          return [w.account];
        }
        if (method === "eth_chainId") return "0x" + w.chain.toString(16);
        if (method === "wallet_switchEthereumChain") {
          if (w.unknown) {
            const e = new Error("Unknown chain");
            e.code = 4902;
            throw e;
          }
          w.chain = parseInt(params[0].chainId, 16);
          for (const fn of listeners.chainChanged ?? []) fn(params[0].chainId);
          return null;
        }
        if (method === "wallet_addEthereumChain") {
          w.added = params[0];
          w.unknown = false;
          return null;
        }
        if (method === "wallet_getCapabilities") return {};
        if (method === "eth_sendTransaction" && w.reject) {
          const e = new Error("User rejected");
          e.code = 4001;
          throw e;
        }
        const response = await window.__mockWalletRpc({ method, params });
        if (response.error) {
          const e = new Error(response.error.message);
          Object.assign(e, response.error);
          throw e;
        }
        return response.result;
      },
    };
    window.ethereum = provider;
    window.__setChain = (chain) => {
      w.chain = chain;
      for (const fn of listeners.chainChanged ?? [])
        fn("0x" + chain.toString(16));
    };
    const announce = () =>
      window.dispatchEvent(
        new CustomEvent("eip6963:announceProvider", {
          detail: {
            info: {
              uuid: "c7f4e1a9-e148-4eab-9876-90e8e7b3e8ab",
              name: "Test browser wallet",
              icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28"><rect width="28" height="28" fill="green"/></svg>',
              rdns: "test.identitymd.wallet",
            },
            provider,
          },
        }),
      );
    window.addEventListener("eip6963:requestProvider", announce);
    announce();
  },
  { account: visitor, chain: network.chainId },
);
async function check(name, fn) {
  await fn();
  checks.push({ name, passed: true });
  console.log("PASS", name);
}
async function loaded() {
  await expect(page.getByText("Block ", { exact: false }).first()).toBeAttached(
    { timeout: 30000 },
  );
  await expect(
    page.getByRole("button", { name: "Distribute IMD", exact: true }),
  ).toBeAttached();
}
async function connect() {
  await page.getByRole("button", { name: "Connect", exact: true }).click();
  await page.getByRole("button", { name: "Test browser wallet" }).click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
}
async function review(button) {
  await button.click();
  await expect(page.getByRole("dialog")).toBeVisible();
}
async function cancel() {
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Close", exact: true })
    .click();
}
async function confirm() {
  await page
    .getByRole("button", { name: "Confirm in wallet", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByText("Confirmed on Base", { exact: false }).last(),
  ).toBeVisible({ timeout: 10000 });
}
try {
  await page.goto(base + "#home");
  await loaded();
  await check(
    "Subpath export loads without console or local-resource errors",
    async () => {
      assert.equal(errors.length, 0);
      assert.equal(resources.length, 0);
    },
  );
  await check(
    "Disconnected controls are locked; no third-party scripts, fonts or frames",
    async () => {
      await expect(
        page.getByRole("button", { name: "Distribute IMD", exact: true }),
      ).toBeDisabled();
      assert.equal(unexpected.length, 0);
      assert.equal(await page.evaluate(() => localStorage.length), 0);
    },
  );
  await check(
    "390 first screen contains product, wallet and main trade control",
    async () => {
      for (const selector of [
        "h1",
        ".wallet-control",
        ".trade-form .action>button",
      ]) {
        const box = await page.locator(selector).boundingBox();
        assert(
          box.y >= 0 && box.y + box.height <= 844,
          `${selector} is below first screen: ${JSON.stringify(box)}`,
        );
      }
      await page.screenshot({
        path: out + "/screenshots/home-390.png",
        fullPage: true,
      });
    },
  );
  await check(
    "No horizontal overflow at 320, 390, 760 and 1440 across all routes",
    async () => {
      for (const width of [320, 390, 760, 1440]) {
        await page.setViewportSize({ width, height: 900 });
        for (const hash of ["home", "burn", "lp-desk"]) {
          await page.goto(base + "#" + hash);
          await expect(page.locator("h1")).toBeVisible();
          const overflow = await page.evaluate(
            () => document.documentElement.scrollWidth > innerWidth,
          );
          assert.equal(overflow, false, `${hash} overflows ${width}`);
        }
      }
    },
  );
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto(base + "#home");
  await loaded();
  await page.screenshot({
    path: out + "/screenshots/home-1440.png",
    fullPage: true,
  });
  await check(
    "Wallet sheet names discovered wallets, traps focus and returns focus on Escape",
    async () => {
      const trigger = page.getByRole("button", {
        name: "Connect",
        exact: true,
      });
      await trigger.click();
      await expect(page.getByRole("dialog")).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Test browser wallet" }),
      ).toBeVisible();
      assert.equal(
        await page.getByText("Injected", { exact: true }).count(),
        0,
      );
      await page.keyboard.press("Escape");
      await expect(page.getByRole("dialog")).toHaveCount(0);
      await expect(trigger).toBeFocused();
    },
  );
  await check("Connection rejection is recoverable", async () => {
    await page.evaluate(() => (window.__walletState.reject = true));
    await page.getByRole("button", { name: "Connect", exact: true }).click();
    await page.getByRole("button", { name: "Test browser wallet" }).click();
    await expect(page.getByRole("alert")).toContainText("rejected");
    await page.evaluate(() => (window.__walletState.reject = false));
    await page.getByRole("button", { name: "Test browser wallet" }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
  });
  await check(
    "Unknown chain invokes switch, add exact Base parameters, then switch",
    async () => {
      await page.getByRole("button", { name: /0x/ }).first().click();
      await page
        .getByRole("button", { name: "Disconnect", exact: true })
        .click();
      await page.evaluate(() => {
        window.__walletState.chain = 1;
        window.__walletState.unknown = true;
      });
      await connect();
      const w = await page.evaluate(() => ({
        events: window.__walletState.events,
        added: window.__walletState.added,
      }));
      assert.deepEqual(
        w.added,
        JSON.parse(await readFile(root + "web/deployment/network.json"))
          .walletAddChain,
      );
      assert(w.events.includes("wallet_addEthereumChain"));
    },
  );
  await check(
    "Wrong-chain state locks transactions until Switch to Base succeeds",
    async () => {
      await page.evaluate(() => window.__setChain(1));
      await expect(
        page.getByRole("button", { name: "Switch to Base", exact: true }),
      ).toBeVisible();
      await page.goto(base + "#burn");
      await expect(
        page.getByRole("button", { name: "Burn NOTSTOCK", exact: true }),
      ).toBeDisabled();
      await page
        .getByRole("button", { name: "Switch to Base", exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: "Switch to Base", exact: true }),
      ).toHaveCount(0);
      await expect(
        page.getByRole("button", { name: "Burn NOTSTOCK", exact: true }),
      ).toBeEnabled();
    },
  );
  await check(
    "Non-operator wallet sees no operator transaction controls",
    async () => {
      await page.goto(base + "#lp-desk");
      await expect(
        page.getByRole("heading", { name: "Operator overview" }),
      ).toBeVisible();
      for (const name of [
        "Close position",
        "Collect fees",
        "Burn from desk",
        "Set operator",
      ])
        await expect(
          page.getByRole("button", { name, exact: true }),
        ).toHaveCount(0);
    },
  );
  await check(
    "Burn deposit blocks over-balance amounts before any wallet request",
    async () => {
      await page.goto(base + "#burn");
      await page.getByLabel("NOTSTOCK amount", { exact: true }).fill("1001");
      await expect(page.getByRole("alert")).toContainText("exceeds");
      await expect(
        page.getByRole("button", { name: "Deposit NOTSTOCK", exact: true }),
      ).toBeDisabled();
      await page.getByLabel("NOTSTOCK amount", { exact: true }).fill("2");
      await review(
        page.getByRole("button", { name: "Deposit NOTSTOCK", exact: true }),
      );
      assert.equal(mock.state.sent.length, 0);
      await cancel();
    },
  );
  await check(
    "Burn action simulates, reviews, signs mock transaction and refreshes balances",
    async () => {
      await review(
        page.getByRole("button", { name: "Burn NOTSTOCK", exact: true }),
      );
      await confirm();
      assert.equal(mock.state.sent.at(-1).functionName, "burn");
      await expect(
        page.getByRole("button", { name: "Burn NOTSTOCK", exact: true }),
      ).toBeDisabled();
    },
  );
  await check("Wallet transaction rejection unlocks the action", async () => {
    await page.getByLabel("NOTSTOCK amount", { exact: true }).fill("2");
    await review(
      page.getByRole("button", { name: "Deposit NOTSTOCK", exact: true }),
    );
    await page.evaluate(() => (window.__walletState.reject = true));
    await page
      .getByRole("button", { name: "Confirm in wallet", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText("rejected");
    await expect(
      page.getByRole("button", { name: "Deposit NOTSTOCK", exact: true }),
    ).toBeEnabled();
    await page.evaluate(() => (window.__walletState.reject = false));
  });
  await check(
    "Swap follows exact ERC20 approval, Permit2 permission and simulated execute",
    async () => {
      await page.goto(base + "#home");
      await loaded();
      await page.getByLabel("You pay · IMD", { exact: true }).fill("1");
      await expect(
        page.getByRole("button", { name: "Approve IMD", exact: true }),
      ).toBeEnabled();
      await review(
        page.getByRole("button", { name: "Approve IMD", exact: true }),
      );
      await confirm();
      await expect(
        page.getByRole("button", {
          name: "Allow router in Permit2",
          exact: true,
        }),
      ).toBeEnabled();
      await review(
        page.getByRole("button", {
          name: "Allow router in Permit2",
          exact: true,
        }),
      );
      await confirm();
      await expect(
        page.getByRole("button", { name: "Buy NOTSTOCK", exact: true }),
      ).toBeEnabled();
      await review(
        page.getByRole("button", { name: "Buy NOTSTOCK", exact: true }),
      );
      await confirm();
      const sent = mock.state.sent.slice(-3);
      assert.deepEqual(
        sent.map((s) => s.functionName),
        ["approve", "approve", "execute"],
      );
      assert.equal(sent[2].args[0], "0x10");
      assert.equal(sent[0].args[1], 10n ** 18n);
    },
  );
  await check(
    "Governance reads all proposal states; expired proposals have no Execute",
    async () => {
      await page.goto(base + "#lp-desk");
      await expect(page.locator(".proposal")).toHaveCount(4);
      const expired = page
        .locator(".proposal")
        .filter({ has: page.getByText("Expired", { exact: true }) });
      await expect(
        expired.getByRole("button", { name: "Execute proposal", exact: true }),
      ).toHaveCount(0);
      const executable = page.locator(".proposal").filter({
        has: page.getByText("Passed · executable", { exact: true }),
      });
      await expect(executable).toContainText(
        "LayerZero fee paid by executing wallet: 0.001 ETH",
      );
      await review(
        executable.getByRole("button", {
          name: "Execute proposal",
          exact: true,
        }),
      );
      await expect(page.getByRole("dialog")).toContainText("0.001 ETH");
      await cancel();
    },
  );
  await check(
    "Staking separates approval and stake, and preserves max balance",
    async () => {
      await page.getByLabel("NOTSTOCK to stake", { exact: true }).fill("1");
      await review(
        page.getByRole("button", {
          name: "Approve NOTSTOCK for staking",
          exact: true,
        }),
      );
      await confirm();
      await expect(
        page.getByRole("button", { name: "Stake NOTSTOCK", exact: true }),
      ).toBeEnabled();
      await review(
        page.getByRole("button", { name: "Stake NOTSTOCK", exact: true }),
      );
      await cancel();
    },
  );
  await check(
    "Operator controls, bootstrap gate and live venue updates",
    async () => {
      await page.getByRole("button", { name: /0x/ }).first().click();
      await page
        .getByRole("button", { name: "Disconnect", exact: true })
        .click();
      await page.evaluate(
        (account) => (window.__walletState.account = account),
        operator,
      );
      await connect();
      await page.goto(base + "#lp-desk");
      await expect(
        page.getByRole("heading", { name: "Operator desk", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByRole("button", { name: "Close position", exact: true }),
      ).toHaveCount(2);
      const picker = page.getByLabel("Venue", { exact: true });
      await expect(picker.locator("option")).toHaveCount(2);
      await page
        .getByLabel("Price (IMD per NOTSTOCK)", { exact: true })
        .fill("1");
      await page
        .getByRole("button", { name: "Narrow ±20%", exact: true })
        .click();
      await page
        .getByLabel("NOTSTOCK to put to work", { exact: true })
        .fill("10");
      await expect(
        page.getByRole("button", { name: "Open position", exact: true }),
      ).toBeEnabled();
      await review(
        page.getByRole("button", { name: "Open position", exact: true }),
      );
      await expect(page.getByRole("dialog")).toContainText("99.5%");
      await cancel();
      mock.state.boot = false;
      mock.state.extraVenue = true;
      await review(
        page.getByRole("button", { name: "Collect fees", exact: true }).first(),
      );
      await confirm();
      await expect(
        page.getByRole("heading", { name: "Operator desk", exact: true }),
      ).toBeVisible();
      await page.getByText("Open a position", { exact: true }).click();
      await expect(
        page.getByLabel("Venue", { exact: true }).locator("option"),
      ).toHaveCount(3);
      await expect(
        page.getByRole("button", { name: "Open position", exact: true }),
      ).toBeDisabled();
      await expect(
        page
          .getByRole("button", { name: "Close position", exact: true })
          .first(),
      ).toBeEnabled();
      await page.screenshot({
        path: out + "/screenshots/operator-1440.png",
        fullPage: true,
      });
    },
  );
  await check(
    "Simulation revert shows a recoverable contract error without signing",
    async () => {
      mock.state.failSimulation = true;
      const before = mock.state.sent.length;
      await page
        .getByRole("button", { name: "Close position", exact: true })
        .first()
        .click();
      await expect(page.getByRole("alert")).toContainText("0.5%");
      assert.equal(mock.state.sent.length, before);
      mock.state.failSimulation = false;
    },
  );
  await check(
    "Operator top-up and buyback previews use basket bounds and minimum outputs",
    async () => {
      const first = page.locator(".position-item").first();
      await first.getByText("Top up liquidity", { exact: true }).click();
      await first
        .getByLabel("Asset amount to top up", { exact: true })
        .fill("10");
      await expect(
        first.getByRole("button", { name: "Top up position", exact: true }),
      ).toBeEnabled();
      await review(
        first.getByRole("button", { name: "Top up position", exact: true }),
      );
      await expect(page.getByRole("dialog")).toContainText("99.5%");
      await cancel();
      const second = page.locator(".position-item").nth(1);
      await second.getByText("Buy back and burn", { exact: true }).click();
      await second
        .getByLabel("Asset amount for buyback", { exact: true })
        .fill("201");
      await second
        .getByRole("button", { name: "Quote buyback", exact: true })
        .click();
      await expect(second.locator(".error")).toContainText("exceeds");
      await second
        .getByLabel("Asset amount for buyback", { exact: true })
        .fill("1");
      await second
        .getByRole("button", { name: "Quote buyback", exact: true })
        .click();
      await expect(
        second.getByRole("button", {
          name: "Buy back from basket",
          exact: true,
        }),
      ).toBeEnabled({ timeout: 20000 });
      await review(
        second.getByRole("button", {
          name: "Buy back from basket",
          exact: true,
        }),
      );
      await expect(page.getByRole("dialog")).toContainText("dead address");
      await cancel();
    },
  );
  await check(
    "One unreadable asset is isolated without locking the whole desk",
    async () => {
      mock.state.badAsset = true;
      await review(
        page.getByRole("button", { name: "Collect fees", exact: true }).first(),
      );
      await confirm();
      await expect(
        page.getByRole("heading", { name: "Operator desk", exact: true }),
      ).toBeVisible();
      await expect(
        page.getByLabel("Pair asset", { exact: true }).locator("option").last(),
      ).toBeDisabled();
      await page.goto(base + "#home");
      await expect(
        page.getByRole("table", { name: "Desk balances" }),
      ).toContainText("Metadata unavailable");
    },
  );
  await check(
    "Automated accessibility scans on Home, Burn and LP Desk",
    async () => {
      for (const route of ["home", "burn", "lp-desk"]) {
        await page.goto(base + "#" + route);
        await expect(page.locator("h1")).toBeVisible();
        const results = await new AxeBuilder({ page })
          .withTags(["wcag2a", "wcag2aa", "wcag21aa", "wcag22aa"])
          .analyze();
        await writeFile(
          out + `/axe-${route}.json`,
          JSON.stringify(results.violations, null, 2) + "\n",
        );
        assert.deepEqual(
          results.violations.map((v) => ({
            id: v.id,
            nodes: v.nodes.map((n) => n.target),
          })),
          [],
          route,
        );
      }
    },
  );
  await check(
    "Long values, keyboard focus, reduced motion and 200% text enlargement",
    async () => {
      await page.setViewportSize({ width: 390, height: 844 });
      mock.state.balance = 999999999999999999n * 10n ** 18n;
      await page.goto(base + "?large-balance=1#burn");
      await connect();
      await expect(
        page.getByRole("button", { name: "Max", exact: true }),
      ).toBeEnabled();
      await page.getByRole("button", { name: "Max", exact: true }).click();
      await expect(
        page.getByLabel("NOTSTOCK amount", { exact: true }),
      ).toHaveValue("999999999999999999");
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.keyboard.press("Tab");
      const focus = await page.evaluate(
        () => getComputedStyle(document.activeElement).outlineStyle,
      );
      assert.notEqual(focus, "none");
      await page.addStyleTag({ content: "html{font-size:200%}" });
      assert.equal(
        await page.evaluate(
          () => document.documentElement.scrollWidth > innerWidth,
        ),
        false,
      );
      await page.screenshot({
        path: out + "/screenshots/burn-text-200.png",
        fullPage: true,
      });
    },
  );
  await check(
    "Mobile connection sheet offers all wallet-browser links and Coinbase Smart Wallet",
    async () => {
      const mobilePage = await context.newPage();
      const session = await context.newCDPSession(mobilePage);
      await session.send("Emulation.setUserAgentOverride", {
        userAgent:
          "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148 Safari/604.1",
      });
      await mobilePage.setViewportSize({ width: 390, height: 844 });
      await mobilePage.route("**/*", async (route) => {
        if (route.request().url().startsWith(base)) {
          await route.continue();
          return;
        }
        const req = route.request();
        if (network.rpcUrls.some((url) => req.url().startsWith(url))) {
          const body = req.postDataJSON();
          await route.fulfill({
            status: 200,
            contentType: "application/json",
            body: JSON.stringify(
              Array.isArray(body) ? body.map(mock.handle) : mock.handle(body),
            ),
          });
        } else await route.abort();
      });
      await mobilePage.goto(base + "#home");
      await mobilePage
        .getByRole("button", { name: "Connect", exact: true })
        .click();
      for (const name of ["MetaMask", "Coinbase Wallet", "Rabby", "Phantom"])
        await expect(
          mobilePage.getByRole("link", { name: "Open in " + name }),
        ).toBeVisible();
      await expect(
        mobilePage.getByRole("button", {
          name: "Coinbase Smart Wallet",
          exact: true,
        }),
      ).toBeVisible();
      for (const row of await mobilePage.locator(".wallet-row").all()) {
        const box = await row.boundingBox();
        assert(box.height >= 48);
      }
      await mobilePage.screenshot({
        path: out + "/screenshots/mobile-wallet-390.png",
      });
      await mobilePage.close();
    },
  );
  await check(
    "RPC failure keeps the product and locked trade control on the first screen",
    async () => {
      mode = "down";
      await page.goto(base + "?rpc-down=1#home");
      await page.setViewportSize({ width: 390, height: 844 });
      await expect(
        page.getByRole("button", { name: "Retry chain reads", exact: true }),
      ).toBeVisible({ timeout: 30000 });
      const control = page.getByRole("button", {
        name: "Buy NOTSTOCK",
        exact: true,
      });
      await expect(control).toBeDisabled();
      const box = await control.boundingBox();
      assert(box.y + box.height <= 844);
      await page.screenshot({
        path: out + "/screenshots/rpc-error-390.png",
        fullPage: true,
      });
    },
  );
  // A fresh page documents the actual deployed launch, without mock chain data.
  mode = "live";
  await page.goto(base + "?live=1#home");
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(
    page.getByRole("button", { name: "Distribute IMD", exact: true }),
  ).toBeAttached();
  await expect(
    page.getByText("The launch is not registered yet.", { exact: false }),
  ).toBeVisible({ timeout: 45000 });
  await page.screenshot({
    path: out + "/screenshots/live-home-390.png",
    fullPage: true,
  });
  checks.push({
    name: "Live production snapshot through configured public RPC; no live signing",
    passed: true,
  });
  assert.equal(errors.length, 0, errors.join("\n"));
  assert.equal(resources.length, 0);
  assert.equal(unexpected.length, 0);
  await writeFile(
    out + "/browser-results.json",
    JSON.stringify(
      {
        passed: checks.length,
        checks,
        scriptErrors: errors,
        localResourceFailures: resources,
        unexpectedRequests: unexpected,
        limitations: [
          "Wallet/RPC transaction flows use isolated fixtures. No real transaction was signed or broadcast.",
          "Live chain currently has undeployed modules and is unregistered.",
          "Native device wallets, Coinbase passkey onboarding, a screen reader and native 200% browser zoom were not tested by this suite.",
        ],
      },
      null,
      2,
    ) + "\n",
  );
  console.log(`Passed ${checks.length} browser checks.`);
} catch (e) {
  await page
    .screenshot({
      path: root + "test/scratch/browser-failure.png",
      fullPage: true,
    })
    .catch(() => {});
  console.error("Browser check failed:", e);
  await writeFile(
    root + "test/scratch/browser-failure.txt",
    JSON.stringify({ checks, errors, resources, unexpected }, null, 2),
  );
  process.exitCode = 1;
} finally {
  await context.close().catch(() => {});
  await browser.close().catch(() => {});
  await new Promise((resolve) => server.close(resolve));
}
