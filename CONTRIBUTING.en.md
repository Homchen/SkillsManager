# Contributing

**Language:** [中文](CONTRIBUTING.md) · English

Thanks for helping improve SkillsManager. **Windows is the primarily supported platform.** Please verify permission, symlink, and installer changes on Windows.

## Setup

- Go: see `go.mod` at the repository root
- Node.js + pnpm: see `packageManager` in `frontend/package.json`
- [Wails v2 CLI](https://wails.io), matching the Wails version in `go.mod`, for example:

```bash
go install github.com/wailsapp/wails/v2/cmd/wails@v2.13.0
```

- [NSIS](https://nsis.sourceforge.io/) if you build the Windows installer

```bash
git clone https://github.com/Homchen/SkillsManager.git
cd SkillsManager
cd frontend && pnpm install && cd ..
wails dev
```

## Build from source

```bash
wails build
```

The executable lands in `build/bin/` (for example `SkillsManager.exe`). The Windows installer needs NSIS installed locally:

```bash
wails build -nsis
```

The installer is typically `build/bin/SkillsManager-<arch>-installer.exe`.

## Tests

Before you send a change:

```bash
go test ./...
cd frontend && pnpm test
```

Symlink tests may `Skip` without link privilege. Do not hand-edit `frontend/wailsjs/` (Wails generates it).

Keep `build/windows/wails.exe.manifest` at `asInvoker`. Do not switch it to `requireAdministrator`.

## Pull requests

- Explain the problem you solved and how you tested it
- Exercise user-visible behavior on Windows when the change affects UI or organize/link flows
- Users write hooks for other Agents themselves ([docs/hooks-extension.en.md](docs/hooks-extension.en.md)); changing this repo’s official installer: [docs/hooks-maintainer.en.md](docs/hooks-maintainer.en.md)

## Releases (maintainers)

1. Set `info.productVersion` in `wails.json` to match the upcoming tag (for example `1.2.0`)
2. Move `[Unreleased]` entries in `CHANGELOG.md` into a new version section titled `## [1.2.0] - YYYY-MM-DD`, then commit
3. Push the tag: `git tag v1.2.0 && git push origin v1.2.0` (the tag must point at a commit that already contains that changelog section)
4. GitHub Actions builds Windows artifacts and uploads them to the Release (unsigned). The version’s changelog is placed at the top of the notes, followed by GitHub’s auto-generated PR / commit list
