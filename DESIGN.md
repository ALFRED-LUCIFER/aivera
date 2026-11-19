# Aivera design system: the case file

Source of truth: the "Design system foundations" artboard in the claude.ai Design canvas "Aivera — Evidence Intelligence" (v0.1, 18 Nov 2026). Every screen artboard in that canvas is the spec for its screen; [`docs/01-design/screens.md`](docs/01-design/screens.md) maps them.

**Ink does the work:** text, actions, scores and selection, in the black and white of the logo. **The highlighter marks cited evidence and nothing else.** The website alone, as the Landing artboard draws it, also lays it on "evidence" in the headline and on "what they have done" in the claims-tests-work line: both name what Aivera counts as evidence. The candidate home hero (CHome artboard) lays it the same way on "what you have done", for the same reason, and on its one Plus call to action, a highlighter button on the ink panel. Status colour always travels with an icon and a word, and every number says whether it was observed, borrowed as a baseline, or projected.

## Typography

| Role                   | Font                | Size / line · weight                                          |
| ---------------------- | ------------------- | ------------------------------------------------------------- |
| Page title (`h1`)      | Bricolage Grotesque | 28 / 36 · 700, letter-spacing −0.02em                         |
| Section heading (`h2`) | Bricolage Grotesque | 18 / 26 · 600, −0.01em                                        |
| Card title (`h3`)      | Hanken Grotesk      | 16 / 24 · 600 (15 / 22 in dense cards)                        |
| Body                   | Hanken Grotesk      | 14 / 20 · 400                                                 |
| Metadata, labels       | Hanken Grotesk      | 13 / 18 · 400 (labels 600). The smallest size in the product. |
| Evidence               | JetBrains Mono      | 13 / 18 · 400                                                 |

Numbers use `font-variant-numeric: tabular-nums`. No other sizes in the product UI; the marketing site, the candidate home and the candidate site's header wordmark (CHome artboard) may use display sizes (`clamp()` headlines in Bricolage 700) and the Landing artboard's reading sizes (15, 16, 17 and 20 px).

## Spacing, radius, controls

- Spacing scale (px): 4 · 8 · 12 · 16 · 24 · 32 · 48.
- Radius: 6 tags · 8 controls · 12 cards. Chips are pills (13 px radius at 26 px height).
- Controls: compact 36 · standard 40 (default) · touch 44 (any coarse pointer). Large marketing buttons 48.
- Focus: 2 px ring in `--focus`, offset 2 px, on every control.
- Motion: 120 ms with `cubic-bezier(.16,1,.3,1)`, named properties only, off under reduced motion. The website's entrance and hero sequence may run longer, in 120 ms steps (every delay and duration a multiple of 120 ms), through `motion` in `features/marketing-home` and the candidate home hero (`marketing.css`) only; the server-rendered page is already in its final state. The hero card's pointer tilt is a spring (no fixed duration), mouse only and off under reduced motion.

## Colour tokens

Themes are set by `data-theme="light"` (default) or `data-theme="dark"` on the root.

| Token                                         | Light                                                                | Dark                                |
| --------------------------------------------- | -------------------------------------------------------------------- | ----------------------------------- |
| `--bg`                                        | `#F6F4F1`                                                            | `#141118`                           |
| `--surface`                                   | `#FFFFFF`                                                            | `#1D1922`                           |
| `--surface-subtle`                            | `#EFECE8`                                                            | `#18141D`                           |
| `--surface-raised`                            | `#FFFFFF`                                                            | `#262130`                           |
| `--border`                                    | `#E4DFD9`                                                            | `#322C3B`                           |
| `--border-strong`                             | `#CFC8C0`                                                            | `#4A4355`                           |
| `--field-border`                              | `#8D868C`                                                            | `#726A7D`                           |
| `--text`                                      | `#1B1720`                                                            | `#F4F1F6`                           |
| `--text-2`                                    | `#55505A`                                                            | `#BDB5C6`                           |
| `--text-3`                                    | `#6A6470`                                                            | `#9A91A5`                           |
| `--action`                                    | `#1B1720`                                                            | `#F4F1F6`                           |
| `--action-hover`                              | `#3A3242`                                                            | `#FFFFFF`                           |
| `--on-action`                                 | `#FFFFFF`                                                            | `#1B1720`                           |
| `--brand` / `--brand-text`                    | `#1B1720`                                                            | `#F4F1F6`                           |
| `--brand-hover`                               | `#000000`                                                            | `#FFFFFF`                           |
| `--brand-subtle`                              | `#E9E5DF`                                                            | `#2C2636`                           |
| `--hl` (highlighter)                          | `#FFE873`                                                            | `#4D4208`                           |
| `--hl-text`                                   | `#1B1720`                                                            | `#FFF3B0`                           |
| `--focus`                                     | `#1B1720`                                                            | `#FFE873`                           |
| `--ok-bg` / `--ok-text` / `--ok-border`       | `#E8F3EA` / `#1F6B3A` / `#BFDCC5`                                    | `#14281B` / `#8FE0A8` / `#24502F`   |
| `--warn-bg` / `--warn-text` / `--warn-border` | `#FDEDE0` / `#9A3412` / `#F2C7A5`                                    | `#33200F` / `#FDBA8C` / `#6A3F1C`   |
| `--err-bg` / `--err-text` / `--err-border`    | `#FCE8E8` / `#A1161D` / `#F1BDBD`                                    | `#351717` / `#FCA5A5` / `#6E2A2A`   |
| `--info-bg` / `--info-text` / `--info-border` | `#E8EFFB` / `#1D4E9E` / `#BCD0F2`                                    | `#142440` / `#A9C8FF` / `#284A80`   |
| `--shadow-1`                                  | `0 1px 2px rgba(27,23,32,.05)`                                       | `none`                              |
| `--shadow-pop`                                | `0 16px 36px -12px rgba(27,23,32,.22), 0 3px 8px rgba(27,23,32,.06)` | `0 18px 44px -10px rgba(0,0,0,.65)` |

Form fields use `--field-border` (≥3:1, WCAG 1.4.11); every other border keeps `--border`/`--border-strong`. Owner decision, 18 Nov 2026.

Text selection uses the highlighter. The marketing site's and the candidate home's dark "ink" panels are `#1B1720` with `#F4F1F6` text.

## Domain components (all in `@aivera/ui`)

| Component                | Rule                                                                                                                                                                     |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **Status chip**          | Subtle ground with its own text and border token, plus an icon and a word: Supported (ok), Needs validation (warn), Contradiction (err), Informational (info).           |
| **Button**               | 40 px. **One primary per view.** Variants: primary (ink), secondary (outlined), ghost, disabled ("Unavailable").                                                         |
| **Value-basis marker**   | Every metric carries one: Observed (solid square), Baseline (outlined square), Projection (dashed square), Not yet available (rule).                                     |
| **Provenance tag**       | Icon and word, never colour alone: Independently corroborated · Candidate-submitted · Claim awaiting validation · Contradictory · Awaiting live defence.                 |
| **Level meter**          | Five segments in neutral ink and the words "N of 5": the level a job needs, never read as a grade.                                                                       |
| **Strength meter**       | Three segments in neutral ink, so it is not read as pass or fail: Strong · Medium · Supporting · Claim only.                                                             |
| **Score bar**            | Solid fill for the backed score, hatched segment for the range still resting on claims, with the caption "62 backed by evidence · up to 78 if claims hold in interview". |
| **Evidence highlight**   | `<mark>` in `--hl`, only on the exact text the assessment cites, plus an ink underline so cited text is identifiable without colour (WCAG 1.4.1).                        |
| **Competency row**       | Name, weight and type ("Weight 20% · mandatory"), strength, provenance, source count link.                                                                               |
| **Preview-confirm card** | Assistant and bulk actions: title "Preview: …", current versus proposed state, consequence text, Confirm / Edit / Cancel, and "Nothing changes until you confirm."       |

## Screen layout

- Recruiter app: left sidebar (My desk, Inbox, Jobs, Candidates, Talent pool, Interviews, Decision packs, Value dashboard; counts as badges), top bar with search, "Synthetic demo data" label, "Ask Aivera" and the account menu; the assistant opens as a side drawer.
- Job pages share a stage strip: Job description → Competencies and rubric → Evidence and ranking → Interviews → Decision.
- Pages are fluid: max-width container, menus stack and wide tables scroll inside their box at phone width.

## Voice

Plain, specific, honest about uncertainty. Say what a number rests on ("7 of 9", "4 decisions"). Never "verified" without a second source. Never "rejected"; say "not taken forward". Use the real counts the screen has.
