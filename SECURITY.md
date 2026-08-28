# 安全说明

**语言：** 中文 · [English](SECURITY.en.md)

请通过 [GitHub Private Vulnerability Reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)（仓库的 Security Advisory）私下报告安全漏洞。

**不要**为安全问题开公开 Issue 或讨论。

报告时请尽量包含：

- 受影响版本（git tag 或 commit）
- 复现步骤与预期 / 实际行为
- 影响范围（例如本地文件越界、提权绕过、密钥泄露）

维护者收到后会确认是否受理，并在修复发布后协调公开时机。本项目不承诺固定响应时限。

翻译密钥等用户机密只应出现在本机 `~/.skillsmanager/.env`，不应写入 `settings.json` 或本仓库。
