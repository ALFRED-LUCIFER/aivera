# Third-party notices

Credalent includes material adapted from the third-party works listed below, under their licences. Packages installed through pnpm carry their own licences in `node_modules`.

## career-ops

- Source: the "Untrusted External Content (CRITICAL)" section of career-ops' `AGENTS.md`.
- Used in: `packages/ai/src/client.ts` (`UNTRUSTED_CONTENT_RULES`, AIV-P1-070).
- Modified: rewritten as a system-prompt rule for candidate sources in hiring assessments. The list of instruction forms is adapted, and the wording and scope are changed.

- Source: `fingerprint-core.mjs` of career-ops.
- Used in: `modules/evidence/src/domain/fingerprint.ts` (normalisation, 64-bit SimHash over word 3-shingles, similarity; AIV-P1-071).
- Modified: ported to TypeScript.

- Source: `skill-proof-core.mjs` and `skill-extract.mjs` of career-ops, and the rule of its evidence-freshness check.
- Used in: `modules/evidence/src/domain/skill-signals/classify.ts`, `modules/evidence/src/domain/skill-signals/vocabulary.ts` and `isStale` in `modules/evidence/src/domain/repository.ts` (AIV-P1-072).
- Modified: ported to TypeScript and changed: grades for one repository source with reason codes instead of report text, compose files read line by line only (no YAML parser), manifests also declare their project's language, certification, marketing and analytics vocabulary left out, report rendering and GitHub transport not ported.

```text
MIT License

Copyright (c) 2026 Santiago Fernández de Valderrama

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
