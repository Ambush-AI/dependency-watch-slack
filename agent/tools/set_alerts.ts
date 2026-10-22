import { defineTool } from "eve/tools";
import { z } from "zod";
import { setAlertTopics } from "#lib/ambush.ts";

export default defineTool({
  description:
    "Change what to alert on when someone says, for example 'also tell me about major incidents', 'only my packages' or 'stop the incident posts'.",
  inputSchema: z.object({ packages: z.boolean(), incidents: z.boolean() }),
  async execute(topics) {
    return setAlertTopics(topics);
  },
});
