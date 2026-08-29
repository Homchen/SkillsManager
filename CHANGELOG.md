# Changelog

本文件记录面向用户的版本变化。打 `v*` tag 发版时，GitHub Actions 会把**对应版本的章节**放到 Release 正文开头，其后追加 GitHub 根据 PR / commit 自动生成的列表。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [1.0.0] - 2026-08-29

首个公开版本。Windows 安装包可从 GitHub Releases 下载。

### Added

- 本机源仓集中保管技能，各工具通过符号链接共用同一份正文
- 对接 Cursor、Claude Code、Codex、OpenCode、Trae、Qoder 等常见 skills 目录，也可加入任意工作目录
- 一键整理：预览后把散落副本迁入源仓并换成链接，支持冲突合并与断链修复
- 按工具批量启用或禁用技能，禁用前状态可恢复
- 技能分组布局（仅影响本应用展示）
- 应用内编辑 `SKILL.md` 及其它技能文件，Markdown 预览支持公式和图表
- 导入文件夹 / zip / `.skill` 包；按工具导出已挂上的技能
- 多语言翻译副本（微软翻译、Azure、OpenAI 兼容接口）
- 可选 Agent hook，统计技能被读取或斜杠调用的次数
- 回收站与保留期内恢复

[Unreleased]: https://github.com/Homchen/SkillsManager/compare/v1.0.0...HEAD
[1.0.0]: https://github.com/Homchen/SkillsManager/releases/tag/v1.0.0
