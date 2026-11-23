# Security Policy

## Supported versions

Security fixes are prepared for the latest version on the default branch.

## Reporting a vulnerability

Please do not publish exploitable details in a public issue. Use GitHub's **Report a
vulnerability** action in the repository's Security tab (private vulnerability
reporting / security advisories), when available. Include the affected revision,
impact, prerequisites and a minimal, non-destructive reproduction. Do not include
real user data, passwords, session cookies or production secrets.

If private reporting is not enabled, contact the repository owner privately before
disclosing technical details publicly.

## Deployment checklist

- Serve the game only over HTTPS and keep `COOKIE_SECURE=true` in production.
  The application forces Secure cookies when `NODE_ENV=production`.
- Set `TRUST_PROXY` only to the exact number of trusted reverse proxies.
- Keep `.env`, SQLite database files, backups and logs outside public static paths.
- Restrict filesystem permissions on the SQLite database and its containing
  directory; protect backups to the same standard.
- For multiple server replicas, configure a shared rate-limit store. The default
  in-memory limiter is process-local and does not coordinate counters between
  replicas.
- Keep Node.js and npm dependencies updated; review Dependabot PRs and CI audit
  results before deployment.
