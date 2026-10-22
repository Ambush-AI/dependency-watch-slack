import { z } from "zod";

/** OSV.dev's name for each registry an SBOM's package URLs name. */
const ECOSYSTEMS: Readonly<Record<string, string>> = {
  npm: "npm",
  pypi: "PyPI",
  cargo: "crates.io",
  golang: "Go",
  maven: "Maven",
  gem: "RubyGems",
  composer: "Packagist",
  nuget: "NuGet",
  hex: "Hex",
  pub: "Pub",
  githubactions: "GitHub Actions",
  swift: "SwiftURL"
};

/** A registry as the SBOM names it, from that name or OSV.dev's, in any
 *  case: "PyPI" is pypi, "crates.io" cargo, "GitHub Actions" githubactions. */
export function registryOf(name: string) {
  const fold = (text: string) => text.toLowerCase().replace(/[^a-z0-9]/g, "");
  const wanted = fold(name);
  const found = Object.entries(ECOSYSTEMS).find(
    ([registry, ecosystem]) =>
      fold(registry) === wanted || fold(ecosystem) === wanted
  );
  return found?.[0] ?? name.trim().toLowerCase();
}

const querySchema = z.object({
  vulns: z
    .array(
      z.object({
        id: z.string(),
        aliases: z.array(z.string()).optional(),
        summary: z.string().optional()
      })
    )
    .optional()
});

/** The advisories OSV.dev lists for one package at one exact version. */
export async function advisoriesFor(
  registry: string,
  name: string,
  version: string
) {
  const response = await fetch("https://api.osv.dev/v1/query", {
    method: "POST",
    body: JSON.stringify({
      package: {
        ecosystem: ECOSYSTEMS[registryOf(registry)] ?? registry,
        name
      },
      version
    }),
    signal: AbortSignal.timeout(30_000)
  });
  if (!response.ok) throw new Error(`OSV.dev answered ${response.status}`);
  const { vulns = [] } = querySchema.parse(await response.json());
  return vulns.map((vuln) => ({
    id: vuln.id,
    aliases: vuln.aliases ?? [],
    summary: vuln.summary ?? null
  }));
}
