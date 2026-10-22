import { defineTool } from "eve/tools";
import { z } from "zod";
import { foldName, readRepo, watchedRepos } from "#lib/github.ts";
import { registryOf } from "#lib/osv.ts";

export default defineTool({
  description:
    "Which watched repos use a package, at which versions, and whether each repo names it itself or gets it through another package. A version is exact only when exact is true; otherwise it is the range the manifest asks for, or null when the manifest names the package without one.",
  inputSchema: z.object({
    package: z.string().describe("The package name as published"),
    registry: z
      .string()
      .optional()
      .describe("npm, pypi, maven, golang, cargo, gem, composer, nuget, githubactions or swift"),
  }),
  async execute(input) {
    const registry = input.registry ? registryOf(input.registry) : null;
    const repos = await watchedRepos();
    return Promise.all(
      repos.map(async (repo) => {
        const read = await readRepo(repo);
        if (!read.ok) return { repo, unreadable: read.why };
        const uses = read.dependencies.filter(
          (dependency) =>
            (!registry || dependency.registry === registry) &&
            foldName(dependency.registry, dependency.name) ===
              foldName(dependency.registry, input.package),
        );
        return { repo, uses };
      }),
    );
  },
});
