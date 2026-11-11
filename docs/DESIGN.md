# The Firm: implemented design

## Overview

The app serves NOTSTOCK holders, governance participants and the liquidity operator. It uses a quiet financial ledger: dark green text on warm paper, a serif product heading, tabular figures and flat rows. The supplied frog logo and exact slogan appear in the header. Controls and chain data take priority over explanation. Home, Burn and LP Desk share the same header, spacing, fields and transaction review.

This document is under `docs/` because the assignment's explicit write budget permits only `web/**`, `dist/**`, `docs/**` and `web/.gitignore`. That scope takes precedence over the conflicting request for a repository-root DESIGN.md.

## Colors

The canonical tokens are in [styles.css](../web/src/styles.css). Components use role tokens, not a parallel palette.

| Token | Value | Role |
| --- | --- | --- |
| `--canvas` | `#f4f3ec` | Warm page background |
| `--surface` | `#fbfaf5` | Inputs and dialogs |
| `--ink` | `#19382c` | Headings, primary text, selected trade tab |
| `--muted` | `#586258` | Labels, context and secondary text |
| `--line` | `#d4d9cc` | Structural separators and input outlines |
| `--accent` | `#204d38` | Primary action fill |
| `--accent-hover` | `#163d2a` | Hovered primary action |
| `--soft` | `#e8ecdf` | Trading panel, wallet rows and previews |
| `--error` | `#9a302d` | Error text with explicit recovery instructions |
| `--warning` | `#77551c` | Incomplete setup and unavailable state |
| `--focus` | `#1c6546` | Keyboard focus perimeter |
| `--white` | `#ffffff` | Text on primary actions |

Measured source-token contrast ratios: ink/canvas 11.49:1; muted/canvas 5.72:1; white/accent 9.63:1; muted/soft 5.30:1; error/canvas 6.66:1; warning/canvas 6.09:1; focus/canvas 6.29:1. The rendered taste probe also passed its resolved-background text contrast checks. This is an intentional light-only system; no theme control or dark theme is present. Status always includes words, not color alone.

## Typography

There are no remote or bundled font downloads. `Arial, Helvetica, sans-serif` supplies interface text; `Georgia, 'Times New Roman', serif` supplies the brand and h1. These are system font stacks, so exact glyph rendering depends on installed fonts.

The six size tokens are 14, 16, 18, 22, 40 and 56 CSS pixels at a default 16px root. CSS weights are 400, 600 and 700; the headline/brand is the heaviest. The desktop h1 uses 56px with -0.04em tracking and 1.2 line height; it steps to 40px below 760px. Section headings use 22px, subordinate headings 18px, body/fields 16px, labels and captions 14px. Inputs remain at least 16px on phones. Paragraphs use 1.6 line height and a 72ch maximum measure. Headings balance their wrapping. Live amounts and deadlines use tabular figures.

Critical addresses and values wrap with `overflow-wrap: anywhere`. The AddressLink pattern offers explorer access, copy and a full-address title; the connected-wallet dialog also displays the full address. Native select controls may visually ellipsize long option labels, while the corresponding venue/asset list retains full links.

## Layout

The page, header and footer share a maximum width of 1240px, with 40px inline padding on wide screens, 28px below 1000px and 20px below 480px. Common spacing increments are 8, 12, 16, 20, 24, 28, 32 and 40px. Sections use space and one structural separator rather than nested cards.

Home uses a two-column layout: the ledger gets 1.5 fractions and trading gets one fraction with a 320px minimum. Below 760px, trading becomes the first grid item, followed by the summary metrics and fee distribution. This order keeps the trade amount, output, action and header wallet control on the first 390×844 screen. Chain errors sit beneath the trade control on Home so the failure state preserves the product and action too. Nothing is hidden to fake a smaller page; all metrics remain below the action.

Two-column forms and report sections collapse to one column below 760px; form fields collapse below 480px. The balance table uses four fluid columns and wraps long values rather than introducing horizontal page scrolling. Operator detail forms use native disclosures. The wallet dialog becomes a full-width bottom sheet below 480px with safe-area padding. The rest of the page remains in normal document flow, with no sticky or floating transaction action.

Rendered reflow was checked at 320, 390, 760 and 1440px on all routes. A 200% text-size stress test and unusually large wallet balance were checked. Native browser 200% zoom, physical devices and an RTL mirror were not verified.

## Elevation & depth

The system is flat. Section dividers establish grouping; `--soft` distinguishes the trade surface. There are no gradients, card shadows or decorative motion. Native dialogs use a dark translucent backdrop and the browser's top layer. Error surfaces are inline and remain readable until the visitor retries or navigates away.

## Shapes

Buttons and fields use a 6px radius. Trading surfaces and dialogs use 12px. Wallet rows use 6px, and mobile bottom sheets use 14px on their upper corners. The small network dot is circular. Buttons generally have a 44px minimum height; wallet rows are at least 52px. Some secondary copy and dialog controls are 32–36px and pass the probe's 24px target/spacing rule.

## Components

[ui.tsx](../web/src/ui.tsx) contains `Field`, `Select`, `Panel`, `Stat`, `AddressLink`, `Empty`, `WalletGate`, `Dialog` and `TxButton`.

`Field` and `Select` bind native labels to unique IDs. `Panel` groups one section with a heading and optional trailing control. `Stat` keeps label, amount, unit and context together. `Empty` explains the next available step rather than showing fabricated figures. `AddressLink` preserves access to full public addresses without making every ledger row wide.

`Dialog` uses native `showModal()`, traps focus through the browser, closes on Escape/backdrop/its close button, and explicitly returns focus to its trigger. `TxButton` owns each action's simulation, review, pending signature, receipt, success and error state. Its confirmation repeats the consequence, amounts and destination. It stays disabled through receipt/refetch, and chain/account/prerequisite checks prevent stale or unauthorized signing.

[wallet.tsx](../web/src/wallet.tsx) supplies the single Connect control and wallet sheet. [swap.tsx](../web/src/swap.tsx) supplies direction, amount, minimum received and approval steps. [PositionEditor.tsx](../web/src/PositionEditor.tsx) reuses the same live asset/venue and price/range preview for direct opens and proposals. [Operator.tsx](../web/src/Operator.tsx) adds position details and operator-only actions without hiding public position state.

Hover states are gated by pointer capability. Focus uses a 2px outline with 3px offset, 4px on primary actions. Press scaling is 0.96, and named-property 120ms transitions exist only under `prefers-reduced-motion: no-preference`. Reduced motion removes those transitions and scaling. There is no infinite animation.

## Do's and don'ts

- Reuse semantic tokens, the six-step type scale, native controls and the shared transaction pattern.
- Keep amounts next to units, show transaction consequences before signing, and distinguish unavailable data from zero.
- Populate asset and venue pickers from chain reads; keep optional-asset failures local to that asset.
- Preserve the supplied slogan and logo, flat rows and shared alignment edges.
- Avoid an added marketing hero, remote fonts, invented prices, cards inside cards or a second deployment-address map.

## References

The implementation applies the pinned Better Interface guide across accessibility, layout, writing, typography, colors and UI. Its consolidated coverage, concrete findings, fixes and limitations are in [validation.md](frontend/validation.md). Supporting MIT/Apache notices are retained in [design-guidance-LICENSE.txt](frontend/design-guidance-LICENSE.txt).
