# Approved frontend requirements coverage

Scope: the deployed frontend stage only. Contract source, root configuration, deployment, public hosting, IPFS publication and naming are not changed by this submission.

| Requirement | Implemented surface / evidence |
| --- | --- |
| Exact logo slogan on Home | `web/src/App.tsx`: supplied local logo followed by “Don't work for the firm. Let the firm work for you.” |
| Home, Burn, LP Desk | Hash routes in App; relative Vite base; production export tested under `/preview/`. |
| Public launch reads on every page | Shared snapshot in `data.ts`; dynamic module and Burner addresses read from LpDesk; missing modules are explicit. |
| NOTSTOCK/IMD price, vault bucket and undistributed amounts | Home metrics and fee distribution; pool price from configured StateView and exact attested pool key. |
| Public Distribute controls and fixed fee split | Separate IMD and NOTSTOCK actions, review before signing; equal four-way IMD split and all NOTSTOCK to Burner. |
| Open LP positions and value | Home and LP Desk show underlying pool holdings in NOTSTOCK plus asset units, excluding uncollected fees. No unsupported USD/aggregate valuation. |
| Per-token free, top-up and buyback balances | Home ledger plus read-only position basket rows. Unsupported asset reads are labeled unavailable, not zero. |
| Project-wallet cumulative receipts and weekly report | Complete indexed transfers since deployment; weekly fee receipts, collected fees, buyback executions and historical dead-balance delta. |
| Burner balance, total burned and public Burn | Burn page; whole-balance burn enabled only for a connected wallet with positive Burner balance and verified chain state. |
| Deposit with balance, Max and over-balance prevention | Plain LaunchToken transfer to live Burner address; exact bigint validation before wallet signature. |
| Stake / unstake and proposal eligibility | Approval is separate from stake; free unstaking; 0.1% staked threshold with the implementation's operator exemption. |
| Every proposal, vote weights and quorum | Complete proposalCount iteration; snapshot weight, for/against totals, 3% quorum, checkpoint and duplicate-vote gating. |
| Vote, veto, execution windows and expiry | 3-day vote, 2-day veto, 3-day execution period; passed countdown; expired proposals have no Execute control. |
| AddVenue, AddAsset, OpenPosition proposal forms | Governor methods with native validation; OpenPosition shares the live asset/venue editor. Direct opening is restricted to bootstrap. |
| Bridge records, every BridgeOut, AddBridge / BridgeOut proposals | Governance records plus complete BridgedOut logs; real quoteSend native fee shown before execution and refreshed in the review preparation. |
| Operator actions only for current operator | Live operator address gates rendering; TxButton rechecks the role before simulation. Non-operators see data without those buttons. |
| Pair/venue pickers are live, with six recognized venue labels | Only PriceGuard assets()/venues() populate options; unrecognized venues retain their full address. Both Slipstream managers are named correctly. |
| Price prefilling and manual creation price | Module prepare/poolPrice calls; existing price prefilled, absent pool left empty; exact required 0.5% warning. |
| Range presets and manual asset-unit ranges | Narrow ±20%, medium ±50%, wide half-to-double, manual inputs, token order/decimals aware ticks. |
| Preview before signature | Ticks, quoted deposit amounts, both 99.5% minimums, remaining free balances and destination contract in review. |
| Open only in 7-day bootstrap; Close at any time | Bootstrap end displayed and enforced; browser tests cover both sides of the boundary and persistent Close availability. |
| Shift, collect, close, top up, buyback, burn and move | Per-position operator controls; per-asset withdrawal/redeposit minimums from manual slippage; module top-up quote and 99.5% liquidity floor; isolated buyback baskets; free NOTSTOCK burn. |
| Basket and free-balance bounds | Exact bigint validation; no wallet signature for an over-balance action; unreadable optional assets are disabled. |
| Operator transfer and post-launch settings | Role transfer, hash-verified module file deployment, exact genesis allocation, factory recipient, registration, split and claimFees controls. |
| No third-party script/font/frame before Connect | Local assets and system fonts; browser request inspection found none. Public RPC reads are expected. No analytics or app persistence. |
| EIP-6963, mobile wallet browsers and Coinbase Smart Wallet | Named extension sheet; four mobile browser links/marks; Coinbase SDK loaded through its connector; no relay/project ID. |
| Wrong chain and missing-chain add | Single Switch to Base control; unknown-chain failure offers exact walletAddChain parameters and switches again. Browser and unit checks pass. |
| Quotes, approvals and swaps use supplied protocol addresses | Runtime network block supplies StateView, quoter, Permit2 and Universal Router. Exact handoff pool key, separate permissions, deadline/minimum and execute simulation. |
| Manifest as runtime configuration | Browser fetches the delivered manifest and its referenced ABI assets; no competing compiled address/ABI map. |
| Complete immutable asset inventory | Validator checks all other export files, SHA-256, canonical ABI Keccak, exact contract set, network/pool identity, relative paths and budgets. |
| Build, typecheck, browser and meaningful interaction validation | Evidence in validation.md and JSON outputs; live public reads, isolated wallet/RPC flows and actual local Base-fork governance. |
| Real AddVenue fork update | Local hash-matching modules, stake, propose, vote, time advance and execute; browser operator picker equals the entire updated live list, with no site change. |
| Small-screen product/action and reflow | 390×844 product/wallet/trade control check, including RPC failure; all routes tested at 320/390/760/1440 with no horizontal overflow. |
| Sharing metadata | Product title, favicon, description, og:title, og:image and Twitter card in index.html; local relative image until publication domain exists. |
| Design guide / six-domain review / design documentation | docs/DESIGN.md and consolidated validation review; root DESIGN.md placement is overridden by the explicit permitted path budget. |

The local fork is a frontend integration check, not a new contract security audit or a repeat of the earlier launch rehearsal. Physical wallet apps, Coinbase passkey onboarding and funded mainnet transactions remain untested. Publication and its independent checks occur after this worker delivery.
