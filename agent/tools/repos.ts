import { defineTool } from "eve/tools";
import { z } from "zod";
import { readRepo, watchedRepos } from "#lib/github.ts";

export default defineTool({
  description:
    "The repos Dependency Watch watches (the ones the GitHub App can see), whether each can be read, and how many packages each uses from each registry.",
  inputSchema: z.object({}),
  async execute() {
    const repos = await watchedRepos();
    return Promise.all(
      repos.map(async (repo) => {
        const read = await readRepo(repo);
        if (!read.ok) return { repo, readable: false, why: read.why };
        const registries: Record<string, number> = {};
        for (const dependency of read.dependencies) {
          registries[dependency.registry] = (registries[dependency.registry] ?? 0) + 1;
        }
        return { repo, readable: true, packages: registries };
      }),
    );
  },
});
