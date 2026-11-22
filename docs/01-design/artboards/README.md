# Screen artboards

Verbatim copies of the artboards in the claude.ai Design canvas "Credalent — Evidence Intelligence" (owner's canvas, read 22 Nov 2026: 86 artboards, adding the platform-admin, Import, Evidence, Calibrate, Message and Settings screens), with `canvas.json`, the canvas layout. Each `.dc.html` is the spec for its screen ([`screens.md`](../screens.md) maps them to routes); `Foundations.dc.html` is the design system sheet that `packages/tokens/src/tokens.json` matches.

- **Build and review from these files** (AGENTS.md section 4): port what the artboard draws, and list every deviation with its reason in the component and the PR.
- **Do not edit them here.** Change the canvas, then copy the files again in the same PR as the screens that follow. They are excluded from Prettier.
- **Synthetic data only.** People, companies and evidence in them are the synthetic cast; a few placeholders use `you@company.com`, which the built screens leave out (AGENTS.md 1.1; messages ship in every page, so an `@example.com` placeholder would trip the PII checks).
- They load fonts from Google Fonts and the canvas runtime (`support.js`, `/_blob/…` images), so they render fully only in the canvas. The logo image is in the app at `apps/web/public/brand/credalent-mark.png`.
