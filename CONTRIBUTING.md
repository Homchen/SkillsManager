# 贡献指南

**语言：** 中文 · [English](CONTRIBUTING.en.md)

感谢你愿意改进 SkillsManager。当前**主要支持 Windows**；请在 Windows 上验证与权限、符号链接、安装器相关的改动。

## 环境

- Go：版本见仓库根目录 `go.mod`
- Node.js + pnpm：见 `frontend/package.json` 的 `packageManager`
- [Wails v2 CLI](https://wails.io)，与 `go.mod` 中的 Wails 版本对齐，例如：

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.13.0
```

- 打 NSIS 安装包时需要 [NSIS](https://nsis.sourceforge.io/)

```bash
git clone https://github.com/Homchen/SkillsManager.git
cd SkillsManager
cd frontend && pnpm install && cd ..
wails dev
```

## 从源码构建

```bash
wails build
```

可执行文件在 `build/bin/`（例如 `SkillsManager.exe`）。Windows 安装包需要本机已装 NSIS：

```bash
wails build -nsis
```

安装包一般为 `build/bin/SkillsManager-<arch>-installer.exe`。

## 测试

提交前请运行：

```bash
go test ./...
cd frontend && pnpm test
```

无建链权限时，symlink 相关用例可能 `Skip`。不要手改 `frontend/wailsjs/`（由 Wails 生成）。

Windows 清单 `build/windows/wails.exe.manifest` 必须保持 `asInvoker`，不要改成 `requireAdministrator`。

## Pull Request

- 说清楚改动解决了什么问题，以及你如何测试
- 用户可见的行为变化请在 Windows 上实际跑过相关流程
- 其它 Agent 的 hook 由用户自己写，见 [docs/hooks-extension.md](docs/hooks-extension.md)；改本仓库官方安装器见 [docs/hooks-maintainer.md](docs/hooks-maintainer.md)

## 发版（维护者）

1. 将 `wails.json` 的 `info.productVersion` 改为与即将打的 tag 一致（例如 `1.2.0`）
2. 推送 tag：`git tag v1.2.0 && git push origin v1.2.0`
3. GitHub Actions 会构建 Windows 产物并上传到 Release（未签名）
