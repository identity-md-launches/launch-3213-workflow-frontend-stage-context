# The Firm frontend

A static Vite, React and TypeScript app for the deployed NOTSTOCK launch on Base. Home shows trading, fee distribution and the live ledger. Burn supports plain token deposits and public burning. LP Desk provides staking, governance, bridges, live venue/asset lists, setup and operator management.

## Install, build and preview

Use Node 22.12 or newer, with npm. From the repository root:

```sh
npm ci --prefix web --legacy-peer-deps
npm run typecheck --prefix web
npm run build --prefix web
npm run validate --prefix web
npm run preview --prefix web -- --port 4173
```

`--legacy-peer-deps` avoids npm resolving optional wallet integrations that this app does not use. The committed lockfile fixes the actual installed dependency set. No registry mirror, dependency archive or `node_modules` directory is needed in Git. A clean installation with this command was checked.

The publisher serves the delivered repository-root `dist/` as plain files. There is no backend or server rewrite. Vite uses `base: './'` and navigation uses hashes, so the export also works at gateway subpaths. `npm run dev --prefix web` starts source development; produce an export with `npm run build --prefix web` after changes. For a development session needing deployment assets, build once, then copy `dist/imd-deployment.json` to `web/public/imd-deployment.json` temporarily and remove that temporary copy afterwards. The production build always regenerates the manifest from the final export.

## Configuration and provenance

The browser reads **only `dist/imd-deployment.json`** for its deployment, chain, public RPC, Uniswap addresses and ABI paths. `src/config.ts` fetches that manifest, checks asset SHA-256 and the attested canonical ABI Keccak hashes, and constructs the public client and wallet configuration. There is no compiled deployment-address map. Its six venue labels are display names only; selectable values always come from PriceGuard.

Build inputs are `deployment/handoff.json` and `deployment/network.json`, preserved from the supplied handoff. They are not imported into the browser bundle. The four deployed contract bindings, pool key and network blocks are copied without changing their values. `public/abi/` contains all nine implementation-derived ABI arrays from source commit `b43bed90f47fce914d8c1bca5c8ae86b00b1681e`. `public/provenance.json` records their canonical hashes and the deployment block used for history, with no additional deployment addresses.

```sh
node web/scripts/provenance.mjs
```

This optional provenance check compares every delivered ABI byte-for-byte with `git show <sourceCommit>:docs/abi/<Contract>.json`. It requires that pinned Git commit locally. Normal builds and runtime operation do not depend on `.imd/reads/` or scratch files.

The build emits `dist/imd-deployment.json` last, after enumerating every other export file and computing its lowercase SHA-256. `npm run validate --prefix web` checks exact handoff bindings, pool/network identity, all file hashes, the complete inventory, metadata, relative paths and file/count budgets. Rebuild after changing an export; editing a built file invalidates the manifest.

## Wallets and transactions

One Connect control lists EIP-6963 wallets and Coinbase Wallet. Mobile browsers offer MetaMask, Coinbase Wallet, Rabby and Phantom browser links plus Coinbase Smart Wallet. No WalletConnect relay or project ID is used. Missing Base support follows switch → exact add-chain parameters → switch. App connection storage is disabled to honor SITE.md's no-storage requirement; reloads require reconnecting. The wallet software may manage its own connection data.

Before a transaction, the app verifies the chain, nonempty contract code and action prerequisites, simulates the call and shows a review dialog. Signing stays with the connected wallet. An operator action also checks the current onchain operator. A changed account or wrong chain at confirmation blocks signing. Each action remains locked through its own receipt and state refresh; rejection and reverts produce persistent inline feedback and allow retry.

For trading, the runtime pool key is used unchanged. The quote is a simulated `quoteExactInputSingle`, then exact ERC-20 approval to Permit2, a separate limited Permit2 router permission and Universal Router `execute(0x10, ...)` with V4 actions `0x060c0f`. There is no ETH value for this IMD pair. Allowances are read again after confirmed approvals. Minimum output uses the visitor's slippage; deadlines and permission expiry use chain time. The extended six-field swap tuple is supported when the supplied network requests it.

LpDesk/FirmVault buybacks use those contracts' own methods. Because they return no output, their previews find the accepted minimum-output bound with read-only simulations pinned to one block. No quote simulation asks a wallet to sign. Position deposits/top-ups use venue-module quotes; pool holdings use integer liquidity math. Withdrawals show amounts before uncollected fees and use operator-selected slippage. These are pool holdings, not a fabricated USD or aggregate portfolio price.

## Reads, setup and reports

Shared snapshots read all deployed launch modules on every route, poll every 15 seconds and refresh immediately after transactions. The longer polling period bounds public-RPC load for the full asset/proposal list. A critical read failure locks transactions and offers Retry. An unreadable optional asset is retained as unavailable with its actions disabled, rather than replacing its balance or breaking the whole desk.

Current live reads show the main contracts and Burner, but undeployed modules and incomplete registration. Setup exposes module deployment with onchain code-hash verification, the project-wallet allocation transfer, factory fee-recipient setting, registration, genesis splitting and claiming factory fees. It never chooses a launch number: it reads a registered number from PriceGuard or asks the visitor to enter the known factory number. The frontend worker did not perform these mainnet setup actions.

Reports use indexed Transfer, FeesSplit, Buyback and BridgedOut logs from the actual deployment block. The weekly window finds its start block by timestamp; the burn delta uses an archival balance read. Project receipts count transfers from the vault/desk to the project wallet, excluding the launch allocation. RPC log-range failures are split into smaller requests. History failures remain visibly unavailable, with no estimated totals or truncated proposal/event history. Long histories can take time and require an RPC supporting historical reads.

## Validation

```sh
npm test --prefix web
npm exec --prefix web -- playwright install chromium
npm run test:browser --prefix web
npm run check:live --prefix web
# Optional full local Base-fork integration, requiring forge and anvil:
npm run test:fork --prefix web
```

Browser tests serve the delivered export at `/preview/`, use isolated RPC/wallet fixtures for transactions and also inspect actual configured-RPC reads. The fork check compiles unchanged contracts into `test/scratch/`, deploys hash-matching modules only on local Anvil, stakes, proposes/votes/executes AddVenue, and compares the browser's operator picker against the updated onchain list. Its manager is a metadata-only fixture; it is not used for liquidity operations. No test broadcasts a transaction to Base.

See [validation evidence](../docs/frontend/validation.md), [requirements coverage](../docs/frontend/requirements.md) and the implemented [design system](../docs/DESIGN.md). Screenshots labeled `live` use actual chain reads; ordinary interaction screenshots use test fixtures; `fork` screenshots use local fork state. Publication URLs, IPFS pinning and named-site verification belong to the subsequent publisher stage.

## Wallet links and notices

Rabby's browser link uses `_cmd=open-dapp&dapp=...` under `/mobile/`, derived from its [release universal-link configuration](https://github.com/RabbyHub/rabby-mobile/blob/41f049943836dbefc82d32725042375921aef2e0/apps/mobile/src/constant/universalLink.ts) and [open-dapp handler](https://github.com/RabbyHub/rabby-mobile/blob/41f049943836dbefc82d32725042375921aef2e0/apps/mobile/src/hooks/universalLink.ts). Physical app handoff remains untested.

The supplied logo and favicon are kept locally. Wallet marks come from RainbowKit 2.2.11; its MIT notice is in `WALLET-ICONS-LICENSE.txt`. The supplied interface/UX guide notices and licenses are retained under `docs/frontend/`. No external fonts, analytics scripts or frames are loaded before Connect. Social metadata uses a relative local image because the publication domain is not assigned yet.
