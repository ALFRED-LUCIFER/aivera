import { z } from 'zod';

// Runtime configuration (AIV-P0-007). In Azure, Container Apps fills these from plain settings and Key Vault
// references; locally from the repo-root .env.local. Add a variable here in the ticket that first reads it.
const webEnvSchema = z
  .object({
    APP_ENV: z.enum(['local', 'dev', 'pilot', 'prod']),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    COMMIT_SHA: z.string().min(1).optional(),
    APPLICATIONINSIGHTS_CONNECTION_STRING: z.string().min(1).optional(),
  })
  // Deployed environments must say which commit runs (health and the deploy smoke test rely on it).
  .refine((e) => e.APP_ENV === 'local' || e.COMMIT_SHA, { path: ['COMMIT_SHA'] })
  .transform((e) => ({ ...e, COMMIT_SHA: e.COMMIT_SHA ?? 'local' }));

export type WebEnv = z.output<typeof webEnvSchema>;

/** Parses the environment, or throws an error that names the missing or invalid variables and never their values. */
export function parseWebEnv(source: Record<string, string | undefined>): WebEnv {
  const result = webEnvSchema.safeParse(source);
  if (result.success) return result.data;
  const names = [...new Set(result.error.issues.map((issue) => issue.path.join('.')))].join(', ');
  throw new Error(`Invalid configuration, missing or invalid: ${names}`);
}

let parsed: WebEnv | undefined;
export const env = (): WebEnv => (parsed ??= parseWebEnv(process.env));
