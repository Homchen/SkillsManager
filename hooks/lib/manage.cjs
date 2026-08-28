#!/usr/bin/env node
"use strict";

const fs = require("node:fs");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

function readJson(filePath) {
  const raw = fs.readFileSync(filePath, "utf8").replace(/^\uFEFF/, "");
  return JSON.parse(raw);
}

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  const body = `${JSON.stringify(value, null, 2)}\n`;
  const tmp = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  fs.writeFileSync(tmp, body, "utf8");
  try {
    fs.renameSync(tmp, filePath);
  } catch {
    fs.copyFileSync(tmp, filePath);
    fs.rmSync(tmp, { force: true });
  }
}

function parseArgs(argv) {
  const args = {
    command: argv[2],
    agent: undefined,
    userHome: process.env.USERPROFILE || process.env.HOME || "",
    all: false,
  };

  for (let i = 3; i < argv.length; i += 1) {
    const item = argv[i];
    if (item === "--agent") {
      args.agent = argv[++i];
    } else if (item === "--user-home") {
      args.userHome = argv[++i];
    } else if (item === "--all") {
      args.all = true;
    } else {
      throw new Error(`Unknown argument: ${item}`);
    }
  }

  return args;
}

function commandAvailable(command) {
  const probe = process.platform === "win32" ? "where" : "which";
  const result = spawnSync(probe, [command], { encoding: "utf8" });
  return result.status === 0;
}

function loadManifest(hooksRoot) {
  return readJson(path.join(hooksRoot, "manifest.json"));
}

function findAgent(manifest, agentId) {
  const agent = (manifest.agents || []).find((item) => item.id === agentId);
  if (!agent) {
    throw new Error(`Unknown agent '${agentId}'.`);
  }
  return agent;
}

function resolveUnderHome(userHome, relativePath) {
  return path.join(userHome, ...relativePath.split("/"));
}

function toPosixPath(filePath) {
  return filePath.replace(/\\/g, "/");
}

function statePath(userHome) {
  return path.join(userHome, ".skillsmanager", "hooks-state.json");
}

function loadState(userHome) {
  const filePath = statePath(userHome);
  if (!fs.existsSync(filePath)) {
    return { version: 1, agents: [] };
  }
  const parsed = readJson(filePath);
  return {
    version: parsed.version || 1,
    agents: Array.isArray(parsed.agents) ? parsed.agents : [],
  };
}

function saveState(userHome, state) {
  writeJson(statePath(userHome), {
    version: 1,
    agents: state.agents,
  });
}

function loadHooksJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return { version: 1, hooks: {} };
  }
  const parsed = readJson(filePath);
  return {
    version: parsed.version || 1,
    hooks: parsed.hooks && typeof parsed.hooks === "object" ? parsed.hooks : {},
  };
}

function loadSettingsJson(filePath) {
  if (!fs.existsSync(filePath)) {
    return {};
  }
  const parsed = readJson(filePath);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(`Invalid settings JSON: ${filePath}`);
  }
  return parsed;
}

function nestedHooksJsonPath(userHome, agent) {
  const relativePath = agent.target.settingsJson || agent.target.hooksJson;
  if (!relativePath) {
    throw new Error(`Agent '${agent.id}' is missing target.settingsJson or target.hooksJson.`);
  }
  return resolveUnderHome(userHome, relativePath);
}

function commandIsManaged(command, managedPrefix) {
  if (typeof command !== "string" || !command) {
    return false;
  }
  const posix = command.replace(/\\/g, "/");
  const needle = String(managedPrefix).replace(/\\/g, "/");
  let from = 0;
  while (from <= posix.length) {
    const idx = posix.indexOf(needle, from);
    if (idx === -1) {
      return false;
    }
    const before = idx === 0 ? "" : posix[idx - 1];
    const beforeOk = idx === 0 || "/\\\"' ".includes(before);
    const afterIdx = idx + needle.length;
    const after = afterIdx >= posix.length ? "" : posix[afterIdx];
    const afterOk = after === "" || after === "/" || after === '"' || after === "'" || after === " ";
    if (beforeOk && afterOk) {
      return true;
    }
    from = idx + 1;
  }
  return false;
}

function stripManagedEntries(hooks, managedPrefix) {
  const next = {};
  for (const [eventName, entries] of Object.entries(hooks)) {
    const list = Array.isArray(entries) ? entries : [entries];
    const kept = list.filter((entry) => {
      const command = entry && typeof entry.command === "string" ? entry.command : "";
      return !commandIsManaged(command, managedPrefix);
    });
    if (kept.length > 0) {
      next[eventName] = kept;
    }
  }
  return next;
}

function entryHasManagedCommand(entry, managedPrefix) {
  if (!entry || typeof entry !== "object") {
    return false;
  }
  if (typeof entry.command === "string" && commandIsManaged(entry.command, managedPrefix)) {
    return true;
  }
  const nested = Array.isArray(entry.hooks) ? entry.hooks : [];
  return nested.some(
    (hook) => typeof hook?.command === "string" && commandIsManaged(hook.command, managedPrefix),
  );
}

function stripClaudeManagedEntries(hooks, managedPrefix) {
  const next = {};
  for (const [eventName, entries] of Object.entries(hooks || {})) {
    const list = Array.isArray(entries) ? entries : [entries];
    const kept = [];
    for (const entry of list) {
      if (!entry || typeof entry !== "object") {
        kept.push(entry);
        continue;
      }
      if (!Array.isArray(entry.hooks)) {
        if (!entryHasManagedCommand(entry, managedPrefix)) {
          kept.push(entry);
        }
        continue;
      }
      const keptHooks = entry.hooks.filter((hook) => {
        const command = hook && typeof hook.command === "string" ? hook.command : "";
        return !commandIsManaged(command, managedPrefix);
      });
      if (keptHooks.length === 0) {
        continue;
      }
      if (keptHooks.length === entry.hooks.length) {
        kept.push(entry);
      } else {
        kept.push({ ...entry, hooks: keptHooks });
      }
    }
    if (kept.length > 0) {
      next[eventName] = kept;
    }
  }
  return next;
}

function expandManagedDirPlaceholder(value, managedDirPosix) {
  if (typeof value === "string") {
    return value.replaceAll("{{managedDir}}", managedDirPosix);
  }
  if (Array.isArray(value)) {
    return value.map((item) => expandManagedDirPlaceholder(item, managedDirPosix));
  }
  if (value && typeof value === "object") {
    const next = {};
    for (const [key, item] of Object.entries(value)) {
      next[key] = expandManagedDirPlaceholder(item, managedDirPosix);
    }
    return next;
  }
  return value;
}

function copyManagedFiles(sourceDir, targetDir, files) {
  fs.mkdirSync(targetDir, { recursive: true });
  for (const fileName of files || []) {
    const src = path.join(sourceDir, fileName);
    if (!fs.existsSync(src)) {
      throw new Error(`Missing source file: ${src}`);
    }
    const dest = path.join(targetDir, fileName);
    // Windows may refuse overwrite when a previous install left a read-only copy.
    fs.rmSync(dest, { force: true });
    fs.copyFileSync(src, dest);
  }
}

function resolveOpenCodePluginPath(userHome, agent) {
  const fileName = path.basename(agent.target.pluginFile || "skillsmanager-opencode.js");
  const xdg = process.env.XDG_CONFIG_HOME && String(process.env.XDG_CONFIG_HOME).trim();
  if (xdg) {
    return path.join(xdg, "opencode", "plugins", fileName);
  }
  return resolveUnderHome(userHome, agent.target.pluginFile);
}

function installOpenCodePlugin(hooksRoot, userHome, agent) {
  const sourceDir = path.join(hooksRoot, agent.id);
  const pluginPath = resolveOpenCodePluginPath(userHome, agent);
  copyManagedFiles(sourceDir, path.dirname(pluginPath), agent.files);
}

function uninstallOpenCodePlugin(userHome, agent) {
  fs.rmSync(resolveOpenCodePluginPath(userHome, agent), { force: true });
}

function installClaudeSettings(hooksRoot, userHome, agent) {
  const managedDir = resolveUnderHome(userHome, agent.target.managedDir);
  const settingsPath = nestedHooksJsonPath(userHome, agent);
  const managedPrefix = `hooks/skillsmanager/${agent.id}`;
  const managedDirPosix = toPosixPath(managedDir);

  copyManagedFiles(path.join(hooksRoot, agent.id), managedDir, agent.files);

  const settings = loadSettingsJson(settingsPath);
  const currentHooks =
    settings.hooks && typeof settings.hooks === "object" && !Array.isArray(settings.hooks)
      ? settings.hooks
      : {};
  const stripped = stripClaudeManagedEntries(currentHooks, managedPrefix);
  const nextHooks = { ...stripped };

  for (const [eventName, entries] of Object.entries(agent.hooks || {})) {
    const desired = expandManagedDirPlaceholder(
      Array.isArray(entries) ? entries : [entries],
      managedDirPosix,
    );
    const current = Array.isArray(nextHooks[eventName]) ? nextHooks[eventName] : [];
    nextHooks[eventName] = [...current, ...desired];
  }

  settings.hooks = nextHooks;
  writeJson(settingsPath, settings);
}

function uninstallClaudeSettings(userHome, agent) {
  const managedDir = resolveUnderHome(userHome, agent.target.managedDir);
  const settingsPath = nestedHooksJsonPath(userHome, agent);
  const managedPrefix = `hooks/skillsmanager/${agent.id}`;

  fs.rmSync(managedDir, { recursive: true, force: true });

  if (!fs.existsSync(settingsPath)) {
    return;
  }

  const settings = loadSettingsJson(settingsPath);
  const currentHooks =
    settings.hooks && typeof settings.hooks === "object" && !Array.isArray(settings.hooks)
      ? settings.hooks
      : {};
  settings.hooks = stripClaudeManagedEntries(currentHooks, managedPrefix);
  writeJson(settingsPath, settings);
}

function installCursorHooks(hooksRoot, userHome, agent) {
  const managedDir = resolveUnderHome(userHome, agent.target.managedDir);
  const hooksJsonPath = resolveUnderHome(userHome, agent.target.hooksJson);
  const managedPrefix = `hooks/skillsmanager/${agent.id}`;
  copyManagedFiles(path.join(hooksRoot, agent.id), managedDir, agent.files);

  const hooksDoc = loadHooksJson(hooksJsonPath);
  hooksDoc.hooks = stripManagedEntries(hooksDoc.hooks, managedPrefix);
  for (const [eventName, entries] of Object.entries(agent.hooks || {})) {
    const desired = Array.isArray(entries) ? entries : [entries];
    const current = Array.isArray(hooksDoc.hooks[eventName]) ? hooksDoc.hooks[eventName] : [];
    hooksDoc.hooks[eventName] = [...current, ...desired];
  }
  writeJson(hooksJsonPath, hooksDoc);
}

function uninstallCursorHooks(userHome, agent) {
  const managedDir = resolveUnderHome(userHome, agent.target.managedDir);
  const hooksJsonPath = resolveUnderHome(userHome, agent.target.hooksJson);
  const managedPrefix = `hooks/skillsmanager/${agent.id}`;

  fs.rmSync(managedDir, { recursive: true, force: true });

  if (fs.existsSync(hooksJsonPath)) {
    const hooksDoc = loadHooksJson(hooksJsonPath);
    hooksDoc.hooks = stripManagedEntries(hooksDoc.hooks, managedPrefix);
    writeJson(hooksJsonPath, hooksDoc);
  }
}

function installAgent(hooksRoot, userHome, agentId) {
  const manifest = loadManifest(hooksRoot);
  const agent = findAgent(manifest, agentId);

  if ((agent.requires || []).includes("node") && !commandAvailable("node")) {
    console.error(
      `Agent '${agentId}' requires node, but node was not found on PATH. Skipping hook install.`,
    );
    process.exitCode = 2;
    return;
  }

  if (agent.target.type === "opencode-plugin") {
    installOpenCodePlugin(hooksRoot, userHome, agent);
  } else if (agent.target.type === "claude-settings" || agent.target.type === "codex-hooks-json") {
    installClaudeSettings(hooksRoot, userHome, agent);
  } else {
    installCursorHooks(hooksRoot, userHome, agent);
  }

  const state = loadState(userHome);
  if (!state.agents.includes(agentId)) {
    state.agents.push(agentId);
  }
  saveState(userHome, state);
  console.log(`Installed agent hooks: ${agentId}`);
}

function uninstallAgent(hooksRoot, userHome, agentId) {
  const manifest = loadManifest(hooksRoot);
  const agent = findAgent(manifest, agentId);
  if (agent.target.type === "opencode-plugin") {
    uninstallOpenCodePlugin(userHome, agent);
  } else if (agent.target.type === "claude-settings" || agent.target.type === "codex-hooks-json") {
    uninstallClaudeSettings(userHome, agent);
  } else {
    uninstallCursorHooks(userHome, agent);
  }

  const state = loadState(userHome);
  state.agents = state.agents.filter((id) => id !== agentId);
  saveState(userHome, state);
  console.log(`Uninstalled agent hooks: ${agentId}`);
}

function uninstallAll(hooksRoot, userHome) {
  const state = loadState(userHome);
  const agents = [...state.agents];
  for (const agentId of agents) {
    uninstallAgent(hooksRoot, userHome, agentId);
  }
}

function main() {
  const hooksRoot = path.join(__dirname, "..");
  const args = parseArgs(process.argv);

  if (!args.userHome) {
    throw new Error("User home is empty; pass --user-home or set USERPROFILE/HOME.");
  }

  if (args.command === "install") {
    if (!args.agent) {
      throw new Error("--agent is required for install");
    }
    installAgent(hooksRoot, args.userHome, args.agent);
    return;
  }

  if (args.command === "uninstall") {
    if (args.all) {
      uninstallAll(hooksRoot, args.userHome);
      return;
    }
    if (!args.agent) {
      throw new Error("--agent or --all is required for uninstall");
    }
    uninstallAgent(hooksRoot, args.userHome, args.agent);
    return;
  }

  throw new Error("Usage: manage.cjs <install|uninstall> [--agent <id>|--all] [--user-home <path>]");
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
