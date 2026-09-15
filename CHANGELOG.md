# Changelog

本文件记录面向用户的版本变化。打 `v*` tag 发版时，GitHub Actions 会把**对应版本的章节**放到 Release 正文开头，其后追加 GitHub 根据 PR / commit 自动生成的列表。

格式参考 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

## [Unreleased]

## [1.1.0] - 2026-09-15

主界面重构，并改进技能列表、整理流程与新手引导。

### Added

- 未提权时，仍位于源仓根目录且已有工具链接的技能会出现在列表中，并提示以管理员身份重启以迁入默认分组；可选择本次跳过，技能仍可查看和编辑，卡片会标「待迁移」
- 设置页支持从磁盘重载配置
- 技能页支持 `/` 快捷搜索、按状态与工具筛选，并为技能生成头像标识
- 使用统计趋势图支持全屏查看
- 新手引导覆盖技能、编辑、整理、设置与使用统计演示

### Changed

- 技能列表扫描对真实副本改用轻量指纹（文件列表、大小，以及 `SKILL.md` 内容），整理预览与执行仍按完整内容哈希判断冲突
- 技能卡片网格只渲染可视区域，长列表滚动更顺畅
- 分栏编辑时 Markdown 预览在停止输入约 200ms 后再刷新，减少大文档卡顿
- 重构主界面：导航、技能、编辑、一键整理、设置、使用统计统一为新的布局与交互（设置分区导航、自定义下拉、全局滚动条、技能卡片与多选操作栏、整理扫描进度与路径分层表格、冲突合并工作台等）
- 删除技能时翻译版本进入回收站，恢复技能时一并恢复

### Fixed

- 未设置原语言时，多语言选择器不再崩溃
- 翻译仓迁移、重命名与错误回滚更可靠
- 整理执行前等待计划提交完成，避免用未提交的计划开跑
- 技能卡片菜单不再被其它层遮挡

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

[Unreleased]: https://github.com/Homchen/SkillsManager/compare/v1.1.0...HEAD
[1.1.0]: https://github.com/Homchen/SkillsManager/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/Homchen/SkillsManager/releases/tag/v1.0.0
