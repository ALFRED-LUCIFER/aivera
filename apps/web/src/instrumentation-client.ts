import { z } from 'zod';

// Next runs this file in the browser before hydration, so before any client module builds a schema. zod's first
// z.object probes `new Function('')`, which the content security policy (no 'unsafe-eval' in production) reports as a
// violation even though zod catches the throw; `jitless` skips the probe (AIV-P1-092).
z.config({ jitless: true });
