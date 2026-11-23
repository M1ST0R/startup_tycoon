# Upstream

This directory vendors the Cloudflare `security-audit` Agent Skill for project-local use.

- Upstream: https://github.com/cloudflare/security-audit-skill
- Pinned upstream commit: `c1c8a8c1471069fb0e188eeaff69b8e8db6564a8`
- Upstream license: MIT (see LICENSE)
- Local path: `.agents/skills/security-audit/`

The skill files are mirrored from the pinned upstream revision. A trailing newline is normalized in the vendored copies for repository blob portability. To refresh, review upstream changes and update this directory as one audited change. The skill requires an OS-enforced sandbox before executing target-controlled code; do not bypass that requirement.
