import { defineWorkflowTool } from "eve/tools";
import { z } from "zod";
import { type AlertTopics, setAlertTopics } from "#lib/ambush.ts";

async function save(topics: AlertTopics) {
  "use step";
  return setAlertTopics(topics);
}

export default defineWorkflowTool({
  description:
    "Ask, with buttons, what to alert on: advisories for packages their repos use, or those plus major security incidents (critical exploited flaws in widely used software, platform breaches, hijacked tools). Subscribes accordingly. Use it right after choose_repos in setup, and whenever someone wants to change what they're alerted on but hasn't said how.",
  inputSchema: z.object({}),
  async execute(_input, ctx) {
    "use workflow";
    const answer = await ctx.ask({
      prompt:
        "What should I alert this channel about? Major incidents are the few a week a team drops everything for, like a hosting platform breach or an exploited flaw in PHP, even when they don't touch your packages.",
      display: "select",
      options: [
        {
          id: "both",
          label: "Packages + major incidents",
          description: "Advisories for your packages, plus the big incidents everyone will be talking about",
          style: "primary",
        },
        { id: "packages", label: "Just my packages", description: "Only advisories for packages your repos use" },
      ],
    });
    if (answer.status !== "answered") return { saved: false, why: answer.status };
    const topics = { packages: true, incidents: answer.optionId === "both" };
    return { saved: true, ...(await save(topics)) };
  },
});
