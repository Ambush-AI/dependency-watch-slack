import { defineTool } from "eve/tools";
import { z } from "zod";
import { applyWatchChoice } from "#lib/watch.ts";

export default defineTool({
  description:
    "Change which repos to watch when someone names them, for example 'watch only storefront and api', 'watch everything' or 'only the ones you can read'.",
  inputSchema: z.object({
    choice: z.enum(["all", "readable", "names"]),
    names: z.array(z.string()).optional().describe("Repo names, with or without the owner, when choice is names"),
  }),
  async execute({ choice, names }) {
    return applyWatchChoice(
      choice === "names" ? { kind: "names", text: (names ?? []).join(",") } : { kind: choice },
    );
  },
});
