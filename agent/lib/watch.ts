import { availableRepos, readableRepos, readRepo } from "#lib/github.ts";
import { updateSettings } from "#lib/settings.ts";

export type WatchChoice =
  | { readonly kind: "all" }
  | { readonly kind: "readable" }
  | { readonly kind: "names"; readonly text: string };

export interface WatchResult {
  /** "all", or the repos now watched. */
  readonly watching: "all" | string[];
  /** Names typed that match no repo the GitHub App can see. */
  readonly unknown: string[];
  /** Watched repos whose dependency graph GitHub won't give us. */
  readonly unreadable: string[];
}

/** Matches `storefront` or `acme/storefront`, in any case, to a visible repo. */
function resolve(name: string, available: readonly string[]): string | undefined {
  const wanted = name.toLowerCase();
  return (
    available.find((repo) => repo.toLowerCase() === wanted) ??
    available.find((repo) => repo.toLowerCase().split("/")[1] === wanted)
  );
}

export async function applyWatchChoice(choice: WatchChoice): Promise<WatchResult> {
  if (choice.kind === "all") {
    await updateSettings({ watch: { mode: "all" } });
    return { watching: "all", unknown: [], unreadable: [] };
  }
  if (choice.kind === "readable") {
    const repos = await readableRepos();
    await updateSettings({ watch: { mode: "list", repos } });
    return { watching: repos, unknown: [], unreadable: [] };
  }
  const available = await availableRepos();
  const names = choice.text
    .split(/[\s,]+/)
    .map((name) => name.trim().replace(/^https:\/\/github\.com\//, "").replace(/\/$/, ""))
    .filter(Boolean);
  const repos = [...new Set(names.map((name) => resolve(name, available)).filter((repo) => repo !== undefined))];
  const unknown = names.filter((name) => !resolve(name, available));
  if (repos.length > 0) await updateSettings({ watch: { mode: "list", repos } });
  const reads = await Promise.all(repos.map(async (repo) => ({ repo, read: await readRepo(repo) })));
  return {
    watching: repos,
    unknown,
    unreadable: reads.filter(({ read }) => !read.ok).map(({ repo }) => repo),
  };
}
