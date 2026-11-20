# Operator console: design spec

The operator console (`/ops/**`, [ADR-012](../adr/ADR-012-operator-console.md)) has no artboard in the claude.ai canvas. This file is its spec until one is drawn; when the canvas gains an operator artboard, it replaces this file in the same PR (AGENTS.md section 4). It applies the Case file ([DESIGN.md](../../DESIGN.md)) to an Operate surface: the people who run Aivera scan, compare and act, so the console borrows the recruiter app's vocabulary and adds nothing decorative. Ticket: AIV-P2-040.

Every colour, size and radius below is a Case file token (`--text`, `text-meta`, `rounded-card`), never a raw value.

## Principles

- **Ink does the work.** The highlighter (`--hl`) is not used anywhere in the console: it marks cited evidence, and the console shows none.
- **Platform metadata only.** No page shows a candidate, a member's name or contact, a score or rubric content (ADR-012 point 7). The shell says so on every page.
- **Every number states its basis** with the shared `ValueBasis` marker (Observed, or Not yet available, never an invented 0).
- **Status always travels with an icon and a word** (`StatusBadge`): Active (ok), Waiting for approval (info), Suspended (warn), Not approved (err).
- **Every change is previewed.** Operator actions open the shared preview-confirm card, with "Nothing changes until you confirm." and a reason of at least 10 characters where the action needs one. Every change is audited (ADR-012 point 8).
- Motion: 120 ms `cubic-bezier(.16,1,.3,1)` on named properties only (`transition-colors`), off under `prefers-reduced-motion`.

## Shell (`features/ops/components/OpsShell.tsx`)

- **Grid:** `lg:grid-cols-[16rem_minmax(0,1fr)]` (sidebar and main column from the `lg` breakpoint), `bg-bg` behind; below `lg` the sidebar stacks above the page.
- **Sidebar** (`bg-surface`, `border-e border-border`, sticky, full height):
  - Wordmark "Aivera operations" in `font-display text-section`, and under it the **"Operator" tag**: ink (`bg-action text-on-action`, `rounded-tag`), a shield icon and the word, so no page reads as the recruiter app.
  - Section list, one icon per section (the recruiter shell's icon grid and stroke, `size-4.5`, `currentColor`): Overview, Workspaces, Approvals, Catalogue, then later sections (Audit log, Requests…) as they ship. The current section is `aria-current="page"`: `bg-action text-on-action font-semibold`, as in the recruiter shell. Targets `h-10`, `pointer-coarse:min-h-11`.
  - **Coming later:** sections without a page sit under a `text-meta` heading "Coming later" in `text-text-3`, not links, each with "Coming soon" for screen readers.
  - **Foot:** the line "Platform metadata only. Candidate data never appears here." with a lock icon; the **identity slot** on `bg-surface-subtle` (initials disc in `bg-action`, the signed-in operator's own name and email; never a list of operators, ADR-012 point 1); then "Sign out" and the icon-only theme switch (`Button variant="ghost" size="iconOnly"`) ("Switch to dark theme" / "Switch to light theme" as its accessible name).
- **Main:** `max-w-7xl`, `px-4 lg:px-10`, `pt-8 pb-14`; skip link to `#content`.

## Page header (`features/shell/components/PageHeader.tsx`)

- Breadcrumb on detail pages (`text-meta`, underlined link back to the list).
- Title `h1` in `font-display text-title`.
- **Description:** one line under the title in `text-body text-text-2`, `max-w-prose`: what the page is for (lists) or the record's tags (detail: status, type, Synthetic).
- **Actions** on the right, wrapping under the title on narrow screens. At most one primary button per view (DESIGN.md); operator status changes are secondary buttons that open the preview-confirm card.

## Stat tile (`StatTile`, `@aivera/ui`)

- `rounded-card border bg-surface p-4 shadow-1`.
- Label `text-meta font-semibold text-text-2`; figure `font-display text-section tabular-nums`; the `ValueBasis` marker beside it.
- Optional detail line (`text-meta text-text-2`: what the figure rests on, "Oldest waiting 2 days") and one link at the foot ("View approvals").
- No figure: "Not yet available" in words with its marker, never 0. Never coloured by good or bad.
- Tiles sit in a responsive grid (`sm:grid-cols-2 xl:grid-cols-4`). They are not the page's structure: a dashboard leads with what needs an operator's decision (see Home), as the recruiter Value dashboard leads with "Needs a human decision".

## Tables (`DataTable`, `@aivera/ui`)

- Caption (screen-reader name), column headers, the first cell links to the record (no prefetch where opening is audited).
- Numbers right-aligned with tabular figures; dates show their time zone in the header ("Created (Asia/Dubai)").
- Pagination in the footer: "Page 1 of 3", Previous page, Next page (compact buttons).
- Search above the table is a `<search>` form; the query travels in the request body, never the URL.

## States

| State   | What it shows                                                                                                    |
| ------- | ---------------------------------------------------------------------------------------------------------------- |
| Empty   | One sentence and what happens next ("No workspaces are waiting for approval."), in the table body.               |
| Loading | The route's `loading.tsx` skeleton in the table's shape, `aria-busy`, and a status line ("Loading workspaces…"). |
| Error   | "We could not load … Try again." with a "Try again" button (`error.tsx` or the table's error slot).              |
| 403     | The shared forbidden page; it never names the console or shows its frame.                                        |

## Detail layout (workspace)

- Header: breadcrumb, name, tags (status, type, Synthetic), the status change action on the right.
- Two columns from `lg` (`lg:grid-cols-[minmax(0,1fr)_22rem]`): the main column holds the working sections (AI token use with today's share of the budget as a neutral ink bar, the 7-day table, the budget form); the side column holds **Platform facts** (term left, value right, one row per fact, `divide-y`) and **Operator actions** as a timeline (dot and rule in ink, newest first, each with its reason). One column below `lg`.

## Home (AIV-P2-051)

- Header "Aivera operations" with a one-line summary.
- First, **Needs an operator**: rows with an icon, what is waiting and a link (workspaces waiting for approval, oldest first; workspaces near their AI budget; a catalogue draft waiting to publish).
- Then a row of stat tiles: workspaces by status, AI tokens today against budgets, approval mode on or off. Each tile links to the filtered list.

## Catalogue editor layout (AIV-P2-045 to 049)

- **Draft banner** above the entries while a draft exists: "Draft — not live. Recruiters see version N." with Discard and "Review and publish" (the page's one primary action).
- **Entry list** grouped by job type or pack, each entry with a status word and icon: Live, Changed in draft, New in draft, Retired.
- **Entry form** in the main column, the entry's meaning, evidence and levels as labelled fields; the fairness check's message under the field it refers to.
- **Diff list** on the publish preview-confirm card: added, changed (before and after), retired, with the reason field and the eval result.
