// The GitHub REST API as a GitHub App installation (AIV-P1-026): public repositories only, every answer zod-checked
// (AGENTS.md 3.7). Errors carry the status only, never a path, which names the candidate's repository (AGENTS.md 1.2).
import { createSign } from 'node:crypto';
import { z } from 'zod';
import { GitHubRateLimited, type GitHubPort } from '../application/repositoryRead.ts';
import type { Commit, OwnedRepository } from '../domain/repository.ts';

/** The app id, its PEM private key and the installation id (Key Vault in Azure; names in .env.example). */
export type GitHubConfig = {
  appId: string;
  privateKey: string;
  installationId: string;
  /** Tests point this at msw; defaults to https://api.github.com. */
  apiUrl?: string;
  now?: () => Date;
};

const PAGE = 100;
const login = z.object({ login: z.string() });
const repositorySchema = z.object({
  fork: z.boolean(),
  private: z.boolean(),
  default_branch: z.string().min(1),
  pushed_at: z.iso.datetime().nullable(),
});
const userSchema = z.object({ type: z.string() });
const ownedSchema = z.object({
  name: z.string().min(1),
  fork: z.boolean(),
  archived: z.boolean(),
  private: z.boolean(),
  size: z.number().int().min(0),
  pushed_at: z.iso.datetime().nullable(),
});
const commitSchema = z.object({
  sha: z.string().min(1),
  author: login.nullable(),
  commit: z.object({ author: z.object({ email: z.string() }).nullable(), message: z.string() }),
});
const searchSchema = z.object({
  items: z.array(z.object({ number: z.number().int().positive(), repository_url: z.url() })),
});
const pullSchema = z.object({ merged_at: z.iso.datetime().nullable(), merged_by: login.nullable() });
const tokenSchema = z.object({ token: z.string().min(1), expires_at: z.iso.datetime() });
const resetSchema = z.coerce.number().int().positive();

const repo = (owner: string, name: string) => `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;

/**
 * The response, or null on 404 (or 409, an empty repository). Throws GitHubRateLimited when the limit is spent, an
 * Error on anything else.
 */
async function call(url: string, bearer: string, now: () => Date, method = 'GET'): Promise<Response | null> {
  const response = await fetch(url, {
    method,
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${bearer}`,
      'x-github-api-version': '2022-11-28',
    },
  });
  if (response.ok) return response;
  if (response.status === 404 || response.status === 409) return null;
  if ([403, 429].includes(response.status) && response.headers.get('x-ratelimit-remaining') === '0')
    throw new GitHubRateLimited(new Date(resetSchema.parse(response.headers.get('x-ratelimit-reset')) * 1000));
  // GitHub's secondary limit (common on search) names a wait in seconds instead.
  const retryAfter = response.headers.get('retry-after');
  if ([403, 429].includes(response.status) && retryAfter)
    throw new GitHubRateLimited(new Date(now().getTime() + resetSchema.parse(retryAfter) * 1000));
  throw new Error(`GitHub request failed with ${response.status}`);
}

const b64 = (value: object) => Buffer.from(JSON.stringify(value)).toString('base64url');

export function createGitHub(config: GitHubConfig): GitHubPort {
  const api = config.apiUrl ?? 'https://api.github.com';
  const now = config.now ?? (() => new Date());
  let cached: { token: string; expiresAt: number } | null = null;

  // The app's JWT (RS256, at most 10 minutes) buys an installation token, kept until 5 minutes before it expires.
  async function token(): Promise<string> {
    if (cached && cached.expiresAt - 300_000 > now().getTime()) return cached.token;
    const iat = Math.floor(now().getTime() / 1000) - 60;
    const unsigned = `${b64({ alg: 'RS256', typ: 'JWT' })}.${b64({ iat, exp: iat + 600, iss: config.appId })}`;
    const jwt = `${unsigned}.${createSign('RSA-SHA256').update(unsigned).sign(config.privateKey, 'base64url')}`;
    const body = await call(`${api}/app/installations/${config.installationId}/access_tokens`, jwt, now, 'POST');
    const parsed = tokenSchema.parse(await body?.json());
    cached = { token: parsed.token, expiresAt: Date.parse(parsed.expires_at) };
    return parsed.token;
  }

  async function get<T>(path: string, schema: z.ZodType<T>): Promise<T | null> {
    const response = await call(`${api}${path}`, await token(), now);
    return response && schema.parse(await response.json());
  }

  /** Follows `rel="next"` (on the API host only) until `limit` items. */
  async function list<T>(path: string, schema: z.ZodType<T>, limit: number) {
    const items: T[] = [];
    let url: string | undefined = `${api}${path}`;
    while (url && items.length < limit) {
      const response = await call(url, await token(), now);
      if (!response) break;
      items.push(...z.array(schema).parse(await response.json()));
      const next = /<([^>]+)>;\s*rel="next"/.exec(response.headers.get('link') ?? '')?.[1];
      url = next?.startsWith(`${api}/`) ? next : undefined;
    }
    return { items: items.slice(0, limit), truncated: url !== undefined || items.length > limit };
  }

  return {
    async repository(owner, name) {
      const found = await get(repo(owner, name), repositorySchema);
      return (
        found && {
          fork: found.fork,
          private: found.private,
          defaultBranch: found.default_branch,
          pushedAt: found.pushed_at ? new Date(found.pushed_at) : null,
        }
      );
    },
    async languages(owner, name) {
      return (await get(`${repo(owner, name)}/languages`, z.record(z.string(), z.number().int().min(0)))) ?? {};
    },
    async tree(owner, name, ref) {
      const tree = await get(
        `${repo(owner, name)}/git/trees/${encodeURIComponent(ref)}?recursive=1`,
        z.object({
          truncated: z.boolean().default(false),
          tree: z.array(z.object({ path: z.string(), type: z.string(), size: z.number().int().min(0).optional() })),
        }),
      );
      return {
        entries: (tree?.tree ?? [])
          .filter((entry) => entry.type === 'blob')
          .map((entry) => ({ path: entry.path, size: entry.size })),
        truncated: tree?.truncated ?? false,
      };
    },
    async fileText(owner, name, path, ref) {
      const file = await get(
        `${repo(owner, name)}/contents/${path.split('/').map(encodeURIComponent).join('/')}?ref=${encodeURIComponent(ref)}`,
        z.object({ type: z.string(), encoding: z.string().optional(), content: z.string().optional() }),
      );
      // A symlink or submodule is not a file to read: null, like a file that is gone.
      if (file?.type !== 'file' || file.encoding !== 'base64' || file.content === undefined) return null;
      return Buffer.from(file.content, 'base64').toString('utf8');
    },
    async commits(owner, name, limit) {
      const { items, truncated } = await list(`${repo(owner, name)}/commits?per_page=${PAGE}`, commitSchema, limit);
      const commits: Commit[] = items.map((c) => ({
        sha: c.sha,
        authorLogin: c.author?.login ?? null,
        authorEmail: c.commit.author?.email ?? null,
        message: c.commit.message,
      }));
      return { commits, truncated };
    },
    async changedPaths(owner, name, sha) {
      const detail = await get(
        `${repo(owner, name)}/commits/${encodeURIComponent(sha)}`,
        z.object({ files: z.array(z.object({ filename: z.string() })).default([]) }),
      );
      return (detail?.files ?? []).map((file) => file.filename);
    },
    async mergedPullRequests(user) {
      const q = encodeURIComponent(`author:${user} is:pr is:merged`);
      const found = await get(`/search/issues?q=${q}&per_page=${PAGE}`, searchSchema);
      return (found?.items ?? []).flatMap((pr) => {
        const match = /\/repos\/([^/]+)\/([^/]+)$/.exec(new URL(pr.repository_url).pathname);
        return match?.[1] && match[2] ? [{ owner: match[1], name: match[2], number: pr.number }] : [];
      });
    },
    async user(account) {
      return get(`/users/${encodeURIComponent(account)}`, userSchema);
    },
    async ownedRepositories(account) {
      // One page: the 30 most recently pushed, which is all the choice of five can use.
      const owned = await get(
        `/users/${encodeURIComponent(account)}/repos?type=owner&sort=pushed&per_page=30`,
        z.array(ownedSchema),
      );
      return (owned ?? []).map((r): OwnedRepository => ({
        ...r,
        pushedAt: r.pushed_at ? new Date(r.pushed_at) : null,
      }));
    },
    async pullRequest(owner, name, number) {
      const pr = await get(`${repo(owner, name)}/pulls/${number}`, pullSchema);
      return pr?.merged_at ? { mergedAt: new Date(pr.merged_at), mergedBy: pr.merged_by?.login ?? null } : null;
    },
  };
}
