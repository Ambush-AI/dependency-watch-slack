import { defineTool } from "eve/tools";
import { z } from "zod";
import { isExactVersion } from "#lib/github.ts";
import { advisoriesFor } from "#lib/osv.ts";

export default defineTool({
  description:
    "The advisories OSV.dev lists for a package at one exact version. Pass the registry and package exactly as uses returned them. An empty list means OSV lists none for that version.",
  inputSchema: z.object({ registry: z.string(), package: z.string(), version: z.string() }),
  async execute(input) {
    // OSV.dev reads a range as if it were a version, and finds nothing.
    if (!isExactVersion(input.version)) {
      return { ...input, checked: false, why: "Not one exact version: OSV.dev can only check one." };
    }
    return { ...input, advisories: await advisoriesFor(input.registry, input.package, input.version) };
  },
});
