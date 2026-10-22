import { defineTool } from "eve/tools";
import { z } from "zod";
import { readSettings } from "#lib/settings.ts";

export default defineTool({
  description:
    "The incident posts held back during the trial week, newest first, and when the trial ends. Use it when someone asks what you would have posted about incidents.",
  inputSchema: z.object({ limit: z.number().int().min(1).max(50).default(20) }),
  async execute({ limit }) {
    const { shadowLog = [], incidentShadowUntil } = await readSettings();
    return { trialEnds: incidentShadowUntil ?? null, heldBack: [...shadowLog].reverse().slice(0, limit) };
  },
});
