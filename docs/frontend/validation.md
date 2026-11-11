# Frontend validation

**Frontend implementation and validation complete; local Git commit unavailable.** This is worker-recorded evidence, not an independent contract audit, publication certification or proof of funded mainnet transaction behavior.

## Scope and final result

The delivered Vite/React/TypeScript source is in `web/`, the complete static export is in repository-root `dist/`, and evidence/design documentation is in `docs/`. All contract sources and root build configuration are preserved. The approved deployment source is `b43bed90f47fce914d8c1bca5c8ae86b00b1681e` on Base 8453. The runtime deployment configuration is the exported manifest, including the exact pool key and supplied network/add-chain blocks.

The final export has **23 declared assets, 1,099,969 asset bytes**, plus the small manifest itself. Every asset is below 8 MiB; the count is below 128 and the export is comfortably below the HTTP verification budget. `integrity-results.json` records the actual validator output. Source, assets, lockfile and evidence are delivered together. Only `web/.gitignore` was added as an ignore file; its explicit budget is the `web/` subtree and its patterns exclude dependencies/caches at every nesting depth. No dependency archives, registry mirror, cache or node_modules is part of the submission.

The root DESIGN.md location conflicts with the assignment's explicit write scope. The implemented document is `docs/DESIGN.md`; no root file was written.

## Commands and outcomes

All commands below completed successfully; the final frontend source was built after its last functional change.

| Check | Outcome / evidence |
| --- | --- |
| Clean `npm ci --legacy-peer-deps` from delivered package/lock files | Passed in an isolated scratch installation; 102 packages installed, npm reported zero vulnerabilities at check time. |
| `npm run typecheck --prefix web` | Passed; also runs at the start of the production build. |
| `npm run build --prefix web` | Passed. Relative Vite export, followed by final manifest generation. Largest JS chunk about 689 kB, about 212 kB gzip; Vite's advisory 500 kB chunk warning remains. |
| `node web/scripts/provenance.mjs` | All nine raw ABI files matched the pinned Git source bytes. All four attested canonical Keccak hashes matched. |
| `npm run validate --prefix web` | Passed complete inventory, SHA-256, ABI, exact contract set, pool/network/add-chain identity, schema/path and size checks. `integrity-results.json`. |
| `npm test --prefix web` | **9/9 passed**. `unit-results.tap`. |
| `npm run test:browser --prefix web` | **24/24 passed**, no script errors, missing local resources or unexpected external requests. `browser-results.json`. |
| Three axe scans, WCAG 2 A/AA, 2.1 AA and 2.2 AA tags | No violations in the tested Home, Burn or LP Desk states. `axe-home.json`, `axe-burn.json`, `axe-lp-desk.json`. |
| `npm run check:live --prefix web` | Passed configured-RPC chain and nonempty deployed-code checks; live contract snapshot in `live-read.json`. |
| `npm run test:fork --prefix web` | Passed actual local Base-fork governance and operator-picker integration. `fork-results.json`. |
| Pinned `taste.mjs --out test/scratch/taste` after the final build | **16/16 passed**, exit 0. Final output copied to `taste.json`, with actual screenshots in `screenshots/taste-390.png` and `taste-1440.png`. |

The provided MCP browser launcher failed before navigation because its Chromium profile socket path was too long. A standalone Playwright Chromium run was used instead. This restricted runner also lacked Chromium's executable-path lookup; a scratch-only compatibility shim supplied the known test executable path, and the launcher used `--single-process --no-zygote --disable-gpu`. The unchanged visual probe ran through a scratch Playwright adapter retaining one browser context. These temporary helpers are not runtime assets or build dependencies. The delivered test scripts use normal Playwright by default, with optional `IMD_BROWSER_SINGLE_PROCESS=1` for constrained runners. Browser/server/fork processes were closed by their foreground test scripts.

The browser suite serves **the production export** at `/preview/`. Transactions use isolated EIP-1193/RPC fixtures, while a separate live pass forwards requests to the exact configured public RPC. The standalone probe directly attempted only the configured public endpoints; its screenshots cover the RPC-unavailable state as well. No live transaction was signed or broadcast.

## Interaction coverage

The suite checks initial/disconnected controls, named wallet discovery, focus return, recoverable connection rejection, missing-chain add with exact Base parameters, wrong-chain transaction locks and recovery, non-operator restrictions, over-balance deposits, Max, burn simulation/review/mock submission/receipt/refetch, wallet transaction rejection, ERC-20 approval → Permit2 permission → simulated router execute, proposal weights/status/expiry, LayerZero fee review, staking approval separation, bootstrap boundary behavior, Close availability, dynamic venue refresh, decoded simulation reverts, top-up/buyback basket bounds and preview minimums, isolated optional-asset failure, large exact balances, keyboard focus, 200% text enlargement and mobile wallet rows. It also verifies the first-screen action during RPC failure.

Amounts, token sorting, mixed decimals, tick bounds, slippage, exact large-integer display, dust-vs-zero display, ABI binding and switch/add behavior have dedicated unit assertions. No raw token encoding or quote uses a guessed deployment address.

The Base fork uses the actual handed-off deployed addresses at block **56154850**. It verifies all four module creation-code hashes, deploys the missing modules only locally, stakes project-wallet tokens, proposes AddVenue, votes, advances local EVM time across the vote/veto windows and executes. The live venue count changes **6 → 7**, proposal state becomes Executed, and the browser's **operator picker values equal the entire updated onchain list** without changing site configuration. The added manager is a metadata-only fixture; this test does not exercise liquidity operations on that fixture. No private key or mainnet-funded transaction is used. The local impersonation and local ETH balance are confined to temporary Anvil.

## Better Interface: consolidated six-domain review

The pinned guide's workflow and core principles in all six domains were read and applied during implementation, followed by source and rendered review.

| Domain | Coverage | Evidence and limits |
| --- | --- | --- |
| Accessibility | Checked | Native buttons/links/labels/dialogs, skip link, focus return, keyboard action path, inline alerts/status, progress labels, minimum target/spacing probe and three axe scans. A real screen-reader session and forced-color rendering were not verified. |
| Layout | Checked | All routes at 320, 390, 760 and 1440px; full values and large balance; native disclosures; mobile sheet; 200% text-size test. No horizontal overflow. Native browser zoom and RTL mirror were not verified. |
| Writing | Checked | Action-specific verbs, token units, exact slogan, consequence-based confirmation, clear balance/chain/revert recovery, explicit missing setup and unavailable values. No invented USD values. |
| Typography | Checked | Two system stacks, six-token scale, at most three CSS weights, 16px phone inputs, tabular data, long-value wrapping. Probe measured 4 repeated sizes at 390 and 3 at 1440, with 5 total sizes including one-offs at each. Exact installed font faces vary by system. |
| Colors | Checked | Role tokens and rendered probe passed contrast. Measured ink/canvas 11.49:1, muted/canvas 5.72:1, white/accent 9.63:1 and muted/soft 5.30:1. Light-only is intentional; no dark variant is claimed. |
| UI | Checked | Rest/hover/focus/pressed/disabled/pending/error/success/empty states, native modal focus, independent action locks through receipts, restrained 120ms interactions and reduced-motion guard. No endless animation or transition-all. Slow-motion manual replay was not performed. |

Final 390×844 probe: product, slogan and wallet control are visible; the trade button's measured rectangle is **x=40, y=765.78, width=310, height=44.39**, ending before 844. The final error-state screenshot also retains the action. The probe measured 27 prose words on that first screen, below its 60-word bar. Its 16 checks include share metadata, contrast, reflow, target spacing, type consistency, copy, surfaces and motion. Five secondary controls are below the comfortable 44px size but pass the 24px minimum/spacing rule.

## Findings, repairs and rechecks

| Severity / source | Reproduced problem | Final repair and evidence |
| --- | --- | --- |
| High — `web/src/styles.css:1149`, `web/src/swap.tsx:211` | Summary metrics and helper text pushed the phone trade action below the fold. A top-level RPC error banner repeated the problem. | Trade precedes summary metrics below 760px; shorter balance hint; Home error feedback follows the action. Browser first-screen checks pass in loaded and failed-RPC states; final probe button ends at 810.17px. |
| High — `web/src/Home.tsx:243` | Changing account temporarily removed the snapshot while a cached report still dereferenced its project wallet, causing a blank render. | Report rendering waits for a matching snapshot. Account disconnect/connect/operator transitions pass without script errors. |
| Medium — `web/src/ui.tsx:145` | Removing the dialog before its effect cleanup could lose focus return. | Capture the dialog node and previous focused element before opening; close and restore explicitly. Escape and focus-return checks pass. |
| High — `web/src/data.ts:168` | Real fork: freeBalance for a listed tokenized asset reverted, rejecting the entire shared snapshot after module deployment. | Isolate optional asset balance/metadata failures, preserve the listed asset as unavailable and disable its actions. Main token/pair failures still lock transactions. Regression test and actual seven-venue fork snapshot pass. No balance is substituted. |
| Medium — `web/src/Home.tsx:120` | A generic decorative fee-bar div had an unsupported aria-label. | Hide the redundant graphic from accessibility APIs; the text legend retains all four shares. Three final axe scans report zero violations. |
| Medium — `web/src/math.ts:25` | Number conversion could round very large token integers or display nonzero dust as zero. | Integer formatting preserves whole-token precision, limits fractional display and labels dust with a bound. Dedicated unit checks plus an exact 999999999999999999 Max-field browser check pass. |
| Medium — `web/src/ui.tsx:269`, `web/src/swap.tsx:319` | A review could become stale after an account change; deadlines relying on the visitor's clock could diverge from chain time. | Recheck chain and signer at confirmation; permission expiry and swap deadline use snapshot chain time. Transaction and approval regression flows pass. |

## Evidence and remaining limits

- `screenshots/live-home-390.png` uses actual deployed state. Live reads show Burner deployed, all four modules undeployed, registration incomplete, no open desk positions and no governor proposals. Related controls remain unavailable; setup is available to the appropriate connected wallets. This worker did not perform mainnet setup.
- `home-390.png`, `home-1440.png`, `operator-1440.png`, `burn-text-200.png`, `mobile-wallet-390.png` and `rpc-error-390.png` are explicitly **mock interaction states**. `fork-add-venue-1440.png` is actual local fork state. `taste-*` images are the unchanged probe's direct render.
- Physical MetaMask/Coinbase/Rabby/Phantom app handoff, real Coinbase passkey onboarding, a screen reader and native browser 200% zoom were not tested. The mobile sheet, marks, links, dimensions and connector choice were checked in Chromium.
- Mainnet funded trades, approvals, staking, burns, LP management and bridge messages were not broadcast. Most transaction interactions are mocked; the AddVenue governance flow is additionally executed on a real Base fork. The earlier deployment/security rehearsal is not recertified here.
- Position amounts exclude uncollected fees. Historical reports need RPC log/archive availability and can take time; failures are explicit. Optional listed assets that do not answer reads remain visible and disabled, with no guessed metadata or balances.
- Social metadata is present with a local relative SVG image. Absolute publication URL and external social-platform unfurling remain publisher checks.
- There is no worker publication URL/CID. Source delivery precedes publication and the independent fixed-CID, named-entrypoint, asset/RPC/code checks. Those checks do not establish browser or funded-swap behavior.

## Local Git delivery constraint

`git add -- web dist docs/DESIGN.md docs/frontend` failed with `Unable to create .git/index.lock: Read-only file system`. No local commit was created. All 105 implementation/export/evidence files present at the initial final inventory were within the allowed paths and totaled 3,854,506 bytes; the subsequent budget report and this note add less than 2 KiB, leaving the complete delivery well below 8 MiB. `submission-budget.json` records that inventory. No existing tracked file was modified, and the source/export remain available for the assignment's submission collector. Git metadata was not bypassed or rewritten elsewhere.
