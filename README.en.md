# SkillsManager

**Language:** [中文](README.md) · English

Keep your AI coding Skills in one place. Edit once, use them everywhere.

Cursor, Claude Code, Codex, OpenCode, and similar tools each keep their own skills folder. The same skill often gets copied many times, so a fix in one place is easy to miss in another. SkillsManager keeps a **single copy** on your machine and lets each tool read it through a link.

**Windows** installers are what we ship. Organizing skills and attaching or removing links needs administrator rights, or Windows Developer Mode turned on.

## Screenshots

<table>
  <tr>
    <td align="center" valign="top" width="50%">
      <img src="assets/homePage.png" alt="Home"><br>
      Home
    </td>
    <td align="center" valign="top" width="50%">
      <img src="assets/enable.png" alt="Enable a skill"><br>
      Enable a skill
    </td>
  </tr>
  <tr>
    <td align="center" valign="top" width="50%">
      <img src="assets/detail.png" alt="Skill details"><br>
      Skill details
    </td>
    <td align="center" valign="top" width="50%">
      <img src="assets/arrange.png" alt="Organize"><br>
      Organize
    </td>
  </tr>
  <tr>
    <td align="center" valign="top" width="50%">
      <img src="assets/usage.png" alt="Usage"><br>
      Usage
    </td>
    <td align="center" valign="top" width="50%">
      <img src="assets/setting.png" alt="Settings"><br>
      Settings
    </td>
  </tr>
</table>

## Features

- **Edit once, every tool sees it:** Skills live in one hub on your machine. Change a skill in the app, and every linked tool reads the same copy — no more paste-and-forget.
- **Works with the tools you already use:** Cursor, Claude Code, Codex, OpenCode, Trae, Qoder, and other common skills folders are ready out of the box. Add any extra working directory when you need it.
- **Gather scattered copies into one set:** Preview first, then move copies into the hub and replace them with links. Merge when both sides changed; repair broken links.
- **Attach or detach skills per tool:** Enable or disable a tool’s skill links in bulk without deleting hub files. Restore the last snapshot from before a disable.
- **Organize the list your way:** Create groups and switch between a flat list and a grouped layout. Groups are only for browsing in this app; tools still link by skill name.
- **Search, read, and edit in place:** Open `SKILL.md` and other files in the skill folder. Markdown preview includes math and diagrams.
- **Import and export to share or migrate:** Drop in a folder, zip, or `.skill` package. Export a tool’s linked skills as a zip.
- **Language versions of the same skill:** Create translated copies and switch between them, or try-translate the description in preview without touching the original. Microsoft Translator works out of the box; Azure and OpenAI-compatible APIs are available too.
- **See which skills actually get used:** Optional Agent hooks track reads and slash-command invocations, then show counts and trends.
- **Undo accidental deletes:** Deleted skills stay in Trash for the retention period and can be restored.

## Install

1. Download the Windows installer (`SkillsManager-*-installer.exe`) from [Releases](https://github.com/Homchen/SkillsManager/releases).
2. Run the installer. It is **not code-signed**; if Windows SmartScreen warns you, choose **Run anyway**.
3. On first launch Windows may ask for administrator permission. Allow it so you can organize skills and create links. Canceling exits without opening the app.

To track skill usage, check the installer options for Cursor, Claude Code, Codex, or OpenCode (Node.js must already be installed). You can also run `hooks\install.ps1 -Agent cursor` later from the install folder.

## Get started

1. Open **Settings**, confirm the hub path (default `%USERPROFILE%\.skillsmanager\skills`), and turn on the tool folders you care about.
2. On the **Skills** page, run **Organize**. Review the preview, resolve any conflicts, then apply.
3. Use **bulk enable / disable by tool** to attach skills to the tools you want.
4. When the list grows, switch to the **grouped layout**, create groups, and move skills into them.
5. Click a skill to edit its files or add scripts and notes. Every tool reads the same hub copy.
6. If you enabled hooks during install, open **Usage** to see how often each skill is read or invoked.

To unhook a tool without deleting hub files, disable all links for that tool.

## License

[MIT](LICENSE). Author: [homchen](https://github.com/Homchen).

Building from source or contributing: [Contributing](CONTRIBUTING.en.md). Report vulnerabilities privately per the [security policy](SECURITY.en.md). Writing a usage-stats hook for your own Agent: [Hooks extension](docs/hooks-extension.en.md).
