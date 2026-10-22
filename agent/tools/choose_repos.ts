import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { availableRepos } from "#lib/github.ts";
import { applyWatchChoice, type WatchChoice } from "#lib/watch.ts";

async function countRepos() {
  "use step";
  return (await availableRepos()).length;
}

async function save(choice: WatchChoice) {
  "use step";
  return applyWatchChoice(choice);
}

export default defineWorkflowTool({
  description:
    "Ask, with buttons, which repos to watch: the ones with dependencies GitHub can read, all of them, or ones they type. Saves the answer. Use it right after watch_here, and whenever someone wants to choose repos but hasn't named them.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    "use workflow";
    // Only the repo list before asking: finding which have dependencies
    // takes seconds, and the question shouldn't wait on it.
    const available = await countRepos();
    const answer = await ctx.ask({
      prompt: `Which repos should I watch? The GitHub App can see ${available}. Pick one, or type repo names separated by commas.`,
      display: "select",
      allowFreeform: true,
      options: [
        {
          id: "readable",
          label: "Repos with dependencies",
          description: "The ones whose dependency graph GitHub can give me",
          style: "primary",
        },
        { id: "all", label: `All ${available}`, description: "Including ones I can't read yet" },
      ],
    });
    if (answer.status !== "answered") return { saved: false, why: answer.status };
    const choice: WatchChoice =
      answer.optionId === "readable" || answer.optionId === "all"
        ? { kind: answer.optionId }
        : { kind: "names", text: answer.text ?? "" };
    return { saved: true, ...(await save(choice)) };
  },
});
