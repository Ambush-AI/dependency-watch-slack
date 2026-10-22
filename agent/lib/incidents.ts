/** The stream behind "major incidents": created in the person's own Ambush
 *  account, so they can see it and tune it there. */
export const INCIDENT_STREAM_NAME = "Major security incidents";

export const INCIDENT_STREAM_PROMPT = `Alert me to security incidents a software team would drop everything for: the ones that will dominate engineering and security news today and may need action now. Alert on:
1. A critical vulnerability with active exploitation or a public exploit in widely deployed software that teams run or build on: language runtimes (PHP, Node.js, Python, Java, Go, Ruby), web servers and proxies (NGINX, Apache, HAProxy), OpenSSL, OpenSSH, glibc, the Linux kernel, databases, Git hosting (GitLab, GitHub), Kubernetes, Docker, or CI/CD systems. A critical flaw letting attackers run code or bypass authentication remotely in a language runtime, web server, OpenSSL, OpenSSH or Git hosting counts as soon as the fix ships, exploited or not.
2. A malicious, hijacked or backdoored release of a widely used package, developer tool or official CLI.
3. A breach of a developer platform, hosting provider, CI service or AI provider that exposes customers' secrets, API keys, tokens or environment variables, or tells customers to rotate credentials.
4. A compromise of a certificate authority or code-signing key that browsers, package managers or operating systems trust.
Each alert should be a first report or a material update: a patch released, exploitation confirmed, or customers told to rotate. Skip routine advisories with no exploitation, low or medium severity, single CVE database entries for niche software, consumer data breaches that need no action from developers, ransomware at companies that are not technology providers, product marketing, opinion, and roundups that only repeat incidents already reported. Also skip browsers and phone or desktop operating systems (Chrome, Safari, iOS, Android, Windows), WordPress plugins and themes, advisory digests that bundle a vendor's routine fixes (monthly security bulletins, a national CERT's list of a vendor's patches), malware in new or little-used packages, notices that repackage someone else's fix (Root, TuxCare, Chainguard, F5, Red Hat, Ubuntu, Debian, SUSE), and research or trend reports about attack techniques.`;

/** Incident posts are logged, not posted, for this long after they're turned
 *  on, so the noise can be judged before it reaches the channel. */
export const SHADOW_DAYS = 7;
