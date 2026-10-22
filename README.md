# Dependency Watch

Dependency Watch tells your team in Slack when a security advisory touches a repo you care about. It listens to Package Security Advisories, an [Ambush](https://ambush.ai) stream that reads the CVE Program, NVD, GitHub's advisory database, OSV.dev and security news as they publish. For each alert, an agent looks up which of your repos use the package and at what version, asks OSV.dev whether that version is affected, and posts one message with the fix. Most alerts touch nothing you use, and then it says nothing.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https%3A%2F%2Fgithub.com%2FAmbush-AI%2Fdependency-watch-slack&project-name=dependency-watch&repository-name=dependency-watch&env=AMBUSH_API_KEY&envDescription=An%20Ambush%20API%20key%2C%20so%20Dependency%20Watch%20can%20subscribe%20itself%20to%20Package%20Security%20Advisories.&envLink=https%3A%2F%2Fapp.ambush.ai%2Fapi-keys&products=%5B%7B%22type%22%3A%22blob%22%2C%22access%22%3A%22private%22%7D%5D&connect=%5B%7B%22type%22%3A%22slack%22%2C%22env%22%3A%22SLACK_CONNECTOR%22%2C%22triggers%22%3Atrue%2C%22triggerPath%22%3A%22%2Feve%2Fv1%2Fslack%22%7D%2C%7B%22type%22%3A%22github%22%2C%22env%22%3A%22GITHUB_CONNECTOR%22%7D%5D)

## Set it up

1. Click **Deploy with Vercel**. Approve Slack, and approve GitHub for the repos you might want watched. Paste an [Ambush API key](https://app.ambush.ai/api-keys) when asked.
2. In Slack, invite the app to the channel alerts should go to and say `@Dependency Watch post alerts here`. It connects itself to Ambush, posts a sample alert so you can see what one looks like, and asks two things: which repos to watch (the ones with dependencies it can read, all of them, or names you type), and what to alert on: advisories for your packages, or those plus major security incidents.

Major incidents are the few a week a team drops everything for, like a hosting platform breach or an exploited flaw in PHP, even when none of your packages is involved. The bot creates a "Major security incidents" stream in your Ambush account for them, checks each one again before saying anything, and tells you whether it touches your repos. For the first week it holds incident posts back; ask `@Dependency Watch what would you have posted?` to see them.

Alerts then post to that channel on their own. Ask it anything by mentioning it, such as `@Dependency Watch are we affected by CVE-2026-12345?`, `@Dependency Watch watch only storefront and api`, or `@Dependency Watch just my packages` to turn incidents off. Mention it in an alert's thread to ask about that alert.

For a private repo, turn on its dependency graph (Settings, then Advanced Security); GitHub builds it for public repos on its own.

The model runs through Vercel AI Gateway, so your Vercel team needs AI Gateway credits.

## How it works

| Path | What it does |
| --- | --- |
| `agent/channels/ambush.ts` | Receives Ambush's signed webhook at `/ambush`; each alert gets its own silent agent session |
| `agent/channels/slack.ts` | Slack through Vercel Connect; passes the channel to `watch_here` |
| `agent/tools/uses.ts`, `repos.ts` | Read each repo's dependencies from GitHub's dependency graph (SBOM) |
| `agent/tools/osv_check.ts` | Asks OSV.dev whether an exact version is affected |
| `agent/tools/notify.ts` | Posts an alert to the chosen channel; the only way an alert reaches anyone |
| `agent/tools/watch_here.ts` | Picks the alert channel, creates the Ambush webhook, and posts the sample alert |
| `agent/tools/choose_repos.ts`, `set_repos.ts` | Which repos to watch, asked with buttons or named in a message |
| `agent/tools/choose_alerts.ts`, `set_alerts.ts` | Packages only, or packages and major incidents; subscribes or pauses each stream |
| `agent/tools/shadow_log.ts` | The incident posts held back during the first week |
| `agent/lib/incidents.ts` | The major-incident stream's prompt |
| `agent/lib/settings.ts` | The alert channel, watched repos and webhook secret, in a private Vercel Blob store |

## Run it locally

```sh
pnpm install
cp .env.example .env.local   # fill in
pnpm dev
```

Without Vercel Connect, set `GITHUB_TOKEN` and `WATCHED_REPOS`; Slack posts need a deployment.
