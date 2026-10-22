import { getToken } from "@vercel/connect";
import { z } from "zod";
import { GITHUB_CONNECTOR } from "#lib/constants.ts";
import { readSettings } from "#lib/settings.ts";

/**
 * What each watched repo depends on, from GitHub's dependency graph: the
 * repo's software bill of materials (SBOM), in SPDX. With a lockfile GitHub
 * knows exact versions; from a manifest alone it has the range it asks for,
 * or no version at all.
 */

export interface Dependency {
  /** The registry, as the SBOM's package URL names it: npm, pypi, maven… */
  readonly registry: string;
  readonly name: string;
  /** The version in use; from a manifest alone, the range it asks for, or
   *  null when it names the package without one. */
  readonly version: string | null;
  /** `version` is one exact version, not a range. */
  readonly exact: boolean;
  /** The repo names it itself, rather than getting it through another. */
  readonly direct: boolean;
}

/** A repo's dependencies, or why they couldn't be read. `transient` means
 *  GitHub may answer another time (a rate limit, a server error, no answer);
 *  otherwise a setting has to change first. */
export type RepoRead =
  | { readonly ok: true; readonly dependencies: readonly Dependency[] }
  | { readonly ok: false; readonly why: string; readonly transient: boolean };

const sbomSchema = z.object({
  sbom: z.object({
    packages: z.array(
      z.object({
        SPDXID: z.string(),
        versionInfo: z.string().nullish(),
        externalRefs: z
          .array(
            z.object({
              referenceType: z.string(),
              referenceLocator: z.string()
            })
          )
          .optional()
      })
    ),
    relationships: z
      .array(
        z.object({
          spdxElementId: z.string(),
          relatedSpdxElement: z.string(),
          relationshipType: z.string()
        })
      )
      .optional()
  })
});

/** GitHub's token: the Connect GitHub App's installation token, or a
 *  GITHUB_TOKEN when running without Connect. */
async function token(): Promise<string> {
  if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
  return getToken(GITHUB_CONNECTOR, { subject: { type: "app" } });
}

const installationReposSchema = z.object({
  total_count: z.number(),
  repositories: z.array(z.object({ full_name: z.string() })),
});

/** The repos that can be watched: WATCHED_REPOS when set, otherwise every
 *  repo the person gave the GitHub App access to when they installed it. */
export async function availableRepos(): Promise<string[]> {
  const fixed = (process.env.WATCHED_REPOS ?? "")
    .split(",")
    .map((repo) => repo.trim())
    .filter(Boolean);
  if (fixed.length > 0) return fixed;
  const repos: string[] = [];
  for (let page = 1; ; page++) {
    const response = await github(`/installation/repositories?per_page=100&page=${page}`);
    if (!response.ok) throw new Error(`GitHub answered ${response.status} listing the app's repos`);
    const body = installationReposSchema.parse(await response.json());
    repos.push(...body.repositories.map((repo) => repo.full_name));
    if (repos.length >= body.total_count || body.repositories.length === 0) return repos;
  }
}

/** The repos to check: the ones chosen in setup that the app can still see,
 *  or every available repo when none were chosen. */
export async function watchedRepos(): Promise<string[]> {
  const [available, { watch }] = await Promise.all([availableRepos(), readSettings()]);
  if (!watch || watch.mode === "all") return available;
  const visible = new Set(available.map((repo) => repo.toLowerCase()));
  return watch.repos.filter((repo) => visible.has(repo.toLowerCase()));
}

const manifestCountsSchema = z.object({
  data: z
    .record(
      z.string(),
      z.object({ dependencyGraphManifests: z.object({ totalCount: z.number() }) }).nullable(),
    )
    .nullish(),
});

/** Each repo's manifest count, or null when GitHub didn't answer for it. */
async function manifestCounts(batch: readonly string[]): Promise<(number | null)[]> {
  const fields = batch.map((repo, i) => {
    const [owner, name] = repo.split("/");
    return `r${i}: repository(owner: ${JSON.stringify(owner)}, name: ${JSON.stringify(name)}) { dependencyGraphManifests(first: 1) { totalCount } }`;
  });
  try {
    const response = await fetch("https://api.github.com/graphql", {
      method: "POST",
      headers: { Authorization: `Bearer ${await token()}`, "Content-Type": "application/json" },
      body: JSON.stringify({ query: `query { ${fields.join("\n")} }` }),
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return batch.map(() => null);
    const { data } = manifestCountsSchema.parse(await response.json());
    return batch.map((_, i) => data?.[`r${i}`]?.dependencyGraphManifests.totalCount ?? null);
  } catch {
    return batch.map(() => null);
  }
}

/** The available repos whose dependency graph lists at least one manifest.
 *  Asked through GraphQL, ten repos a query (more and GitHub times out),
 *  because downloading every repo's SBOM to find out takes minutes. A repo
 *  with the graph off counts zero, the same as one with nothing to depend
 *  on; one GitHub didn't answer for is asked again on its own. */
export async function readableRepos(): Promise<string[]> {
  const counts = new Map<string, number>();
  let pending = await availableRepos();
  for (let attempt = 0; attempt < 4 && pending.length > 0; attempt++) {
    if (attempt > 0) await new Promise((wait) => setTimeout(wait, 1_000 * attempt));
    const batches: string[][] = [];
    for (let i = 0; i < pending.length; i += 10) batches.push(pending.slice(i, i + 10));
    // Four queries at a time: more at once and GitHub answers some with 502s.
    for (let i = 0; i < batches.length; i += 4) {
      const group = batches.slice(i, i + 4);
      const results = await Promise.all(group.map(manifestCounts));
      group.forEach((batch, b) =>
        batch.forEach((repo, r) => {
          const count = results[b]?.[r];
          if (typeof count === "number") counts.set(repo, count);
        }),
      );
    }
    pending = pending.filter((repo) => !counts.has(repo));
  }
  return [...counts].filter(([, count]) => count > 0).map(([repo]) => repo);
}

/* A read is kept a day: a repo's dependencies change when it merges, not by
   the minute. One that failed until a setting changes is kept ten minutes,
   so every report doesn't ask again; one that may work next time isn't
   kept. A read under way is shared by everyone asking for it. */
const KEEP_MS = 24 * 60 * 60 * 1000;
const KEEP_FAILED_MS = 10 * 60 * 1000;
const cache = new Map<string, { until: number; read: Promise<RepoRead> }>();

/* GitHub throttles bursts: a hundred SBOM reads at once come back as
   secondary rate limits, so only a few run at a time. */
const MAX_IN_FLIGHT = 8;
let inFlight = 0;
const waiting: (() => void)[] = [];

async function github(path: string) {
  if (inFlight >= MAX_IN_FLIGHT) await new Promise<void>((resume) => waiting.push(resume));
  inFlight++;
  try {
    return await fetch(`https://api.github.com${path}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "X-GitHub-Api-Version": "2022-11-28",
        Authorization: `Bearer ${await token()}`
      },
      signal: AbortSignal.timeout(30_000)
    });
  } finally {
    inFlight--;
    waiting.shift()?.();
  }
}

function decode(part: string) {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** `pkg:npm/%40scope/name@1.2.3` → npm, @scope/name, 1.2.3. */
function parsePurl(purl: string) {
  const match = /^pkg:([^/]+)\/([^?#]+)/.exec(purl);
  if (!match?.[1] || !match[2]) return null;
  const path = match[2];
  const at = path.lastIndexOf("@");
  const segments = (at > 0 ? path.slice(0, at) : path).split("/").map(decode);
  const registry = match[1].toLowerCase();
  return {
    registry,
    name: registry === "maven" ? segments.join(":") : segments.join("/"),
    version: at > 0 ? decode(path.slice(at + 1)) : null
  };
}

/** A name as its registry compares names: PyPI treats case, hyphens,
 *  underscores and dots alike, crates.io hyphens and underscores. */
export function foldName(registry: string, name: string) {
  const lower = name.trim().toLowerCase();
  if (registry === "pypi") return lower.replace(/[-_.]+/g, "-");
  if (registry === "cargo") return lower.replace(/_/g, "-");
  return lower;
}

/* One version, as a lockfile resolves it (4.4.1, v0.50.0, 2.31.0.post1,
   1.0.0-rc.5), rather than a manifest's range (^4.4.1, >= 2, 1.x, 4.*.*).
   A commit a GitHub Action is pinned to is no version OSV.dev can check. */
const EXACT_VERSION = /^v?\d+(?:\.\d+)*(?:[-+.]?[0-9A-Za-z][0-9A-Za-z.+-]*)?$/;
const WILDCARD_PART = /(?:^|\.)[xX*](?:\.|$)/;
const COMMIT = /^[0-9a-f]{40}$/;

export function isExactVersion(version: string) {
  return (
    EXACT_VERSION.test(version) &&
    !WILDCARD_PART.test(version) &&
    !COMMIT.test(version)
  );
}

function dependenciesIn(sbom: z.infer<typeof sbomSchema>["sbom"]) {
  const { packages, relationships = [] } = sbom;
  const root = relationships.find(
    (edge) => edge.relationshipType === "DESCRIBES"
  )?.relatedSpdxElement;
  const direct = new Set(
    relationships
      .filter(
        (edge) =>
          edge.relationshipType === "DEPENDS_ON" && edge.spdxElementId === root
      )
      .map((edge) => edge.relatedSpdxElement)
  );
  /* A monorepo's SBOM lists a package once for each workspace using it. */
  const byKey = new Map<string, Dependency>();
  for (const entry of packages) {
    if (entry.SPDXID === root) continue;
    const purl = entry.externalRefs?.find(
      (ref) => ref.referenceType === "purl"
    )?.referenceLocator;
    const id = purl ? parsePurl(purl) : null;
    if (!id) continue;
    /* A bare name in requirements.txt comes with no version at all. */
    const version = (id.version ?? entry.versionInfo)?.trim() || null;
    const key = `${id.registry}:${foldName(id.registry, id.name)}@${version ?? ""}`;
    const seen = byKey.get(key);
    const isDirect = direct.has(entry.SPDXID);
    byKey.set(
      key,
      seen
        ? { ...seen, direct: seen.direct || isDirect }
        : {
            registry: id.registry,
            name: id.name,
            version,
            exact: version !== null && isExactVersion(version),
            direct: isDirect
          }
    );
  }
  return [...byKey.values()];
}

async function read(repo: string): Promise<RepoRead> {
  const failed = (why: string, transient = false): RepoRead => ({
    ok: false,
    why,
    transient
  });
  let response: Response;
  try {
    response = await github(`/repos/${repo}/dependency-graph/sbom`);
    if (response.status === 404) {
      /* The repo answering while its SBOM doesn't means the graph is off. */
      const repoResponse = await github(`/repos/${repo}`);
      if (repoResponse.ok) return failed("its dependency graph is off");
      if (repoResponse.status === 404) {
        return failed("no such repo, or the GitHub App can't see it");
      }
      response = repoResponse;
    }
    if (response.ok) {
      const parsed = sbomSchema.safeParse(await response.json());
      return parsed.success
        ? { ok: true, dependencies: dependenciesIn(parsed.data.sbom) }
        : failed("GitHub sent no SBOM");
    }
  } catch (error) {
    return failed(`GitHub didn't answer (${error})`, true);
  }
  /* A used-up rate limit comes back as 403 or 429, and its headers say so. */
  if (
    response.status === 429 ||
    response.headers.get("x-ratelimit-remaining") === "0" ||
    response.headers.has("retry-after")
  ) {
    return failed("GitHub's rate limit is used up", true);
  }
  if (response.status === 401) return failed("GitHub refuses the app's token");
  if (response.status === 403) return failed("the GitHub App can't read it");
  return failed(`GitHub answered ${response.status}`, response.status >= 500);
}

export function readRepo(repo: string): Promise<RepoRead> {
  const hit = cache.get(repo);
  if (hit && Date.now() < hit.until) return hit.read;
  const entry = { until: Number.POSITIVE_INFINITY, read: read(repo) };
  cache.set(repo, entry);
  void entry.read.then((result) => {
    entry.until =
      Date.now() +
      (result.ok ? KEEP_MS : result.transient ? 0 : KEEP_FAILED_MS);
  });
  return entry.read;
}
