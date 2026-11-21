import { log } from '@credalent/observability';
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
  'AUTH_ENTRA_CANDIDATE_CLIENT_ID',
  'AUTH_ENTRA_CANDIDATE_CLIENT_SECRET',
  'AUTH_GOOGLE_CLIENT_ID',
  'AUTH_GOOGLE_CLIENT_SECRET',
  'AUTH_GOOGLE_ISSUER',
] as const;
const CANDIDATE_KEYS = ['AUTH_ENTRA_CANDIDATE_CLIENT_ID', 'AUTH_ENTRA_CANDIDATE_CLIENT_SECRET'] as const;
const GOOGLE_KEYS = ['AUTH_GOOGLE_CLIENT_ID', 'AUTH_GOOGLE_CLIENT_SECRET'] as const;

// Credalent operators (AIV-P2-035, ADR-012): comma-separated emails, compared lower-case with the identity user's email.
const operatorList = z
  .string()
  .transform((value) => value.split(',').map((email) => email.trim().toLowerCase()))
  .pipe(z.array(z.email()).min(1));

/**
 * The operator emails, or none when unset, empty or invalid (fails closed, and the app still starts). An invalid list
 * is logged without its value: it holds the operators' emails (AGENTS.md 1.2). Exported for its test.
 */
export function parseOperatorEmails(value: string | undefined): ReadonlySet<string> {
  if (!value?.trim()) return new Set();
  const parsed = operatorList.safeParse(value);
  if (parsed.success) return new Set(parsed.data);
  log.warn({ area: 'ops' }, 'platform operator config invalid');
  return new Set();
}

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
    // Candidate sign-in (AIV-P0-011, docs/runbooks/candidate-sign-in.md): the same tenant and session secret, the
    // candidate app registration. Needs the recruiter settings too; optional everywhere until the candidate site ships.
    AUTH_ENTRA_CANDIDATE_CLIENT_ID: z.string().min(1).optional(),
    AUTH_ENTRA_CANDIDATE_CLIENT_SECRET: z.string().min(1).optional(),
    // Recruiter "Continue with Google" straight to Google (AIV-P0-928): the tenant cannot create Google users. Unset, the
    // button is hidden. AUTH_GOOGLE_ISSUER is local only: the end-to-end tests' mocked provider.
    AUTH_GOOGLE_CLIENT_ID: z.string().min(1).optional(),
    AUTH_GOOGLE_CLIENT_SECRET: z.string().min(1).optional(),
    AUTH_GOOGLE_ISSUER: z.url({ protocol: /^https?$/ }).optional(),
    // Never refuses to start: a bad list means no operators (parseOperatorEmails).
    PLATFORM_OPERATOR_EMAILS: z.string().optional(),
    // The ACS delivery-report webhook's key (AIV-P0-017, Key Vault acs-webhook-key). Unset, the webhook answers 404.
    ACS_WEBHOOK_KEY: z.string().min(32).optional(),
    // Email (AIV-P0-017, AIV-P1-003): the send log's column key (Key Vault notifications-encryption-key) and the public
    // origin for links in emails (also read by Auth.js; set on Azure in infra/modules/web.bicep). Unset, no email can be
    // queued, so nothing that sends one (an invitation) can be done.
    NOTIFICATIONS_ENCRYPTION_KEY: z.string().min(1).optional(),
    AUTH_URL: z.url({ protocol: /^https?$/ }).optional(),
    // Uploads (AIV-P0-016): the storage account's blob endpoint (infra/modules/storage.bicep); unset, no upload or
    // download is offered. MALWARE_SCANNING defaults on and the pilot and production refuse to start without it.
    // shortcut: malware scanning off in dev (synthetic data, owner decision 20 Nov 2026); the pilot sets MALWARE_SCANNING=on
    AZURE_STORAGE_BLOB_URL: z.url({ protocol: /^https$/ }).optional(),
    MALWARE_SCANNING: z.enum(['on', 'off']).default('on'),
  })
  // Deployed environments must say which commit runs (health and the deploy smoke test rely on it).
  .refine((e) => e.APP_ENV === 'local' || e.COMMIT_SHA, { path: ['COMMIT_SHA'] })
  // SAFETY: an upload is never marked clean without Defender's scan where real candidate files live.
  .refine((e) => e.MALWARE_SCANNING === 'on' || e.APP_ENV === 'local' || e.APP_ENV === 'dev', {
    path: ['MALWARE_SCANNING'],
  })
  // Auth.js trusts the request host (trustHost); where real people sign in, the public origin is pinned instead.
  .refine((e) => e.AUTH_URL || (e.APP_ENV !== 'pilot' && e.APP_ENV !== 'prod'), { path: ['AUTH_URL'] })
  // Sign-in is all or nothing, and pilot and prod cannot run without it. Local and dev may run without it until the
  // tenant exists: then no session can be made, so every recruiter page redirects to /sign-in (fails closed).
  .superRefine((e, ctx) => {
    const missing = (key: (typeof AUTH_KEYS)[number]) => ctx.addIssue({ code: 'custom', path: [key], message: '' });
    if (e.AUTH_ENTRA_ISSUER && e.APP_ENV !== 'local') missing('AUTH_ENTRA_ISSUER');
    if (e.AUTH_GOOGLE_ISSUER && e.APP_ENV !== 'local') missing('AUTH_GOOGLE_ISSUER');
    if (!(e.APP_ENV === 'pilot' || e.APP_ENV === 'prod' || AUTH_KEYS.some((key) => e[key]))) return;
    const needed = ['AUTH_SECRET', 'AUTH_ENTRA_CLIENT_ID', 'AUTH_ENTRA_CLIENT_SECRET'] as const;
    const tenant = ['AUTH_ENTRA_TENANT_SUBDOMAIN', 'AUTH_ENTRA_TENANT_ID'] as const;
    for (const key of e.AUTH_ENTRA_ISSUER ? needed : [...needed, ...tenant]) if (!e[key]) missing(key);
    if (CANDIDATE_KEYS.some((key) => e[key])) for (const key of CANDIDATE_KEYS) if (!e[key]) missing(key);
    if (GOOGLE_KEYS.some((key) => e[key]) || e.AUTH_GOOGLE_ISSUER)
      for (const key of GOOGLE_KEYS) if (!e[key]) missing(key);
  })
  .transform(
    ({ AUTH_SECRET: secret, AUTH_ENTRA_CLIENT_ID: clientId, AUTH_ENTRA_CLIENT_SECRET: clientSecret, ...e }) => {
      const {
        AUTH_ENTRA_TENANT_SUBDOMAIN: subdomain,
        AUTH_ENTRA_TENANT_ID: tenantId,
        AUTH_ENTRA_ISSUER: mock,
        AUTH_ENTRA_CANDIDATE_CLIENT_ID: candidateClientId,
        AUTH_ENTRA_CANDIDATE_CLIENT_SECRET: candidateClientSecret,
        AUTH_GOOGLE_CLIENT_ID: googleClientId,
        AUTH_GOOGLE_CLIENT_SECRET: googleClientSecret,
        AUTH_GOOGLE_ISSUER: googleIssuer,
        PLATFORM_OPERATOR_EMAILS: operatorEmails,
        ...rest
      } = e;
      // External ID serves its metadata on the subdomain host but names the tenant-id host as the issuer.
      const discoveryBase = mock ?? (subdomain && tenantId && `https://${subdomain}.ciamlogin.com/${tenantId}/v2.0`);
      const auth =
        secret && clientId && clientSecret && discoveryBase
          ? {
              secret,
              clientId,
              clientSecret,
              issuer: mock ?? `https://${tenantId}.ciamlogin.com/${tenantId}/v2.0`,
              discovery: `${discoveryBase}/.well-known/openid-configuration`,
              google:
                googleClientId && googleClientSecret
                  ? { clientId: googleClientId, clientSecret: googleClientSecret, issuer: googleIssuer }
                  : null,
            }
          : null;
      return {
        ...rest,
        COMMIT_SHA: rest.COMMIT_SHA ?? 'local',
        auth,
        candidateAuth:
          auth && candidateClientId && candidateClientSecret
            ? // No Google on the candidate side: its redirect URI is not registered (AIV-P0-928 is recruiter only).
              { ...auth, clientId: candidateClientId, clientSecret: candidateClientSecret, google: null }
            : null,
        platformOperators: parseOperatorEmails(operatorEmails),
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
