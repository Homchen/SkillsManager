# Security Policy

**Language:** [中文](SECURITY.md) · English

Please report security vulnerabilities privately via [GitHub Private Vulnerability Reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability) (Security Advisories on this repository).

**Do not** open a public issue or discussion for security problems.

Include as much of the following as you can:

- Affected version (git tag or commit)
- Steps to reproduce, plus expected vs actual behavior
- Impact (for example path escape, elevation bypass, secret leakage)

Maintainers will confirm whether the report is accepted and coordinate disclosure after a fix is released. There is no guaranteed response SLA.

User secrets such as translation API keys belong only in the local `~/.skillsmanager/.env` file. They must not be written to `settings.json` or this repository.
