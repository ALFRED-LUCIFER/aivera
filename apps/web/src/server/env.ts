import { z } from 'zod';

// Runtime configuration (AIV-P0-007). In Azure, Container Apps fills these from plain settings and Key Vault
// references; locally from the repo-root .env.local. Add a variable here in the ticket that first reads it.
const AUTH_KEYS = [
  'AUTH_SECRET',
  'AUTH_ENTRA_TENANT_SUBDOMAIN',
  'AUTH_ENTRA_TENANT_ID',
  'AUTH_ENTRA_CLIENT_ID',
  'AUTH_ENTRA_CLIENT_SECRET',
  'AUTH_ENTRA_ISSUER',
] as const;

const webEnvSchema = z
  .object({
    APP_ENV: z.enum(['local', 'dev', 'pilot', 'prod']),
    DATABASE_URL: z.url({ protocol: /^postgres(ql)?$/ }),
    COMMIT_SHA: z.string().min(1).optional(),
    APPLICATIONINSIGHTS_CONNECTION_STRING: z.string().min(1).optional(),
    // Recruiter sign-in on the Entra External ID tenant (AIV-P0-009, docs/runbooks/recruiter-sign-in.md).
    AUTH_SECRET: z.string().min(32).optional(),
    AUTH_ENTRA_TENANT_SUBDOMAIN: z
      .string()
      .regex(/^[a-z0-9-]+$/i)
      .optional(),
    AUTH_ENTRA_TENANT_ID: z.uuid().optional(),
    AUTH_ENTRA_CLIENT_ID: z.string().min(1).optional(),
    AUTH_ENTRA_CLIENT_SECRET: z.string().min(1).optional(),
    // Local only: the mocked provider of the end-to-end tests, in place of the tenant subdomain and id.
    AUTH_ENTRA_ISSUER: z.url({ protocol: /^https?$/ }).optional(),
  })
  // Deployed environments must say which commit runs (health and the deploy smoke test rely on it).
  .refine((e) => e.APP_ENV === 'local' || e.COMMIT_SHA, { path: ['COMMIT_SHA'] })
  // Sign-in is all or nothing, and pilot and prod cannot run without it. Local and dev may run without it until the
  // tenant exists: then no session can be made, so every recruiter page redirects to /sign-in (fails closed).
  .superRefine((e, ctx) => {
    const missing = (key: (typeof AUTH_KEYS)[number]) => ctx.addIssue({ code: 'custom', path: [key], message: '' });
    if (e.AUTH_ENTRA_ISSUER && e.APP_ENV !== 'local') missing('AUTH_ENTRA_ISSUER');
    if (!(e.APP_ENV === 'pilot' || e.APP_ENV === 'prod' || AUTH_KEYS.some((key) => e[key]))) return;
    const needed = ['AUTH_SECRET', 'AUTH_ENTRA_CLIENT_ID', 'AUTH_ENTRA_CLIENT_SECRET'] as const;
    const tenant = ['AUTH_ENTRA_TENANT_SUBDOMAIN', 'AUTH_ENTRA_TENANT_ID'] as const;
    for (const key of e.AUTH_ENTRA_ISSUER ? needed : [...needed, ...tenant]) if (!e[key]) missing(key);
  })
  .transform(
    ({ AUTH_SECRET: secret, AUTH_ENTRA_CLIENT_ID: clientId, AUTH_ENTRA_CLIENT_SECRET: clientSecret, ...e }) => {
      const {
        AUTH_ENTRA_TENANT_SUBDOMAIN: subdomain,
        AUTH_ENTRA_TENANT_ID: tenantId,
        AUTH_ENTRA_ISSUER: mock,
        ...rest
      } = e;
      // External ID serves its metadata on the subdomain host but names the tenant-id host as the issuer.
      const discoveryBase = mock ?? (subdomain && tenantId && `https://${subdomain}.ciamlogin.com/${tenantId}/v2.0`);
      return {
        ...rest,
        COMMIT_SHA: rest.COMMIT_SHA ?? 'local',
        auth:
          secret && clientId && clientSecret && discoveryBase
            ? {
                secret,
                clientId,
                clientSecret,
                issuer: mock ?? `https://${tenantId}.ciamlogin.com/${tenantId}/v2.0`,
                discovery: `${discoveryBase}/.well-known/openid-configuration`,
              }
            : null,
      };
    },
  );

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
