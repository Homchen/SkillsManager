/**
 * Codex hook: record skill usage.
 *
 * Covers:
 * - UserPromptSubmit: user typed /skill-name (does NOT go through file reads)
 * - PreToolUse Skill: Codex-compatible Skill tool payloads, when present
 * - PreToolUse Read/MCP-read: agent reads a SKILL.md file
 * - PreToolUse Bash/shell_command: agent shells out to inspect a SKILL.md file
 *
 * Shares ~/.skillsmanager/skills/skill-usage.json with the other Agent hooks.
 * Always exit 0 with empty stdout so the hook never injects context or blocks Codex.
 */

const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

/** Slash skill ids: /grill-with-docs, /create-hook, ... */
const slashSkillRe = /(?:^|[\s])[/$]([a-z0-9]+(?:-[a-z0-9]+)*)(?![/\w])/gi;
const quotedSkillPathRe = /["']([^"']*[\\/]SKILL\.md)["']/gi;
const unquotedSkillPathRe = /([^\s"']*[\\/]SKILL\.md)\b/gi;

function skillsDirPath() {
  const home = os.homedir();
  if (!home) {
    throw new Error("Cannot determine the current user's home directory.");
  }
  return path.join(home, ".skillsmanager", "skills");
}

function usageFilePath() {
  return path.join(skillsDirPath(), "skill-usage.json");
}

const statsFile = usageFilePath();
const lockFile = `${statsFile}.lock`;
const lockTimeoutMs = 2_000;
const staleLockMs = 10_000;

function isRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function sanitizeJsonInput(input) {
  return String(input || "").replace(/^(?:\uFEFF|\u200B)+/, "");
}

function normalizeSkillName(skillName) {
  return String(skillName || "")
    .trim()
    .replace(/^\//, "");
}

function extractSlashSkillNames(prompt) {
  if (typeof prompt !== "string" || !prompt.trim()) {
    return [];
  }

  const names = [];
  slashSkillRe.lastIndex = 0;
  let match;
  while ((match = slashSkillRe.exec(prompt)) !== null) {
    const name = normalizeSkillName(match[1]);
    if (name) {
      names.push(name);
    }
  }
  return [...new Set(names)];
}

function extractCandidatePath(payload) {
  if (!isRecord(payload)) {
    return undefined;
  }

  const topKeys = ["file_path", "filePath", "target_file", "targetFile", "path"];
  for (const key of topKeys) {
    if (typeof payload[key] === "string" && payload[key].trim()) {
      return payload[key];
    }
  }

  if (isRecord(payload.tool_input)) {
    const inputKeys = ["path", "file_path", "filePath", "target_file", "targetFile"];
    for (const key of inputKeys) {
      if (typeof payload.tool_input[key] === "string" && payload.tool_input[key].trim()) {
        return payload.tool_input[key];
      }
    }
  }

  return undefined;
}

function toLocalPath(candidate) {
  if (typeof candidate !== "string" || !candidate.trim()) {
    return undefined;
  }
  if (candidate.startsWith("file://")) {
    try {
      return fileURLToPath(candidate);
    } catch {
      return undefined;
    }
  }
  return candidate;
}

function isSkillFile(filePath) {
  return typeof filePath === "string" && /(?:^|[\\/])SKILL\.md$/i.test(filePath);
}

function resolveSkillKey(filePath) {
  const skillDir = path.dirname(filePath);
  const parentName = path.basename(skillDir);
  const skillIdCandidate = path.basename(path.dirname(skillDir));
  const translationRootName = path.basename(path.dirname(path.dirname(skillDir)));
  if (translationRootName === "skills_translation" && skillIdCandidate) {
    return skillIdCandidate;
  }
  return parentName || "unknown";
}

function isReadLikeTool(toolName) {
  const normalized = String(toolName || "").trim();
  if (!normalized) {
    return true;
  }
  return /^read$/i.test(normalized) || /^mcp__.*read/i.test(normalized);
}

function extractSkillPathsFromCommand(command) {
  if (typeof command !== "string" || !command.trim()) {
    return [];
  }

  const paths = [];
  for (const pattern of [quotedSkillPathRe, unquotedSkillPathRe]) {
    pattern.lastIndex = 0;
    let match;
    while ((match = pattern.exec(command)) !== null) {
      const filePath = toLocalPath(match[1]);
      if (filePath && isSkillFile(filePath)) {
        paths.push(filePath);
      }
    }
  }
  return [...new Set(paths)];
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function sleep(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireLock() {
  const deadline = Date.now() + lockTimeoutMs;
  while (Date.now() < deadline) {
    try {
      const handle = await fs.open(lockFile, "wx");
      try {
        await handle.writeFile(String(process.pid), "utf8");
      } catch {
        // pid is best-effort
      }
      return handle;
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      try {
        const lockInfo = await fs.stat(lockFile);
        let stale = Date.now() - lockInfo.mtimeMs > staleLockMs;
        if (!stale) {
          try {
            const owner = Number((await fs.readFile(lockFile, "utf8")).trim());
            if (Number.isInteger(owner) && owner > 0) {
              try {
                process.kill(owner, 0);
              } catch {
                stale = true;
              }
            }
          } catch {
            // unreadable lock; wait until mtime stale
          }
        }
        if (stale) {
          await fs.unlink(lockFile).catch(() => {});
          continue;
        }
      } catch (lockError) {
        if (lockError?.code !== "ENOENT") {
          throw lockError;
        }
      }
      await sleep(25);
    }
  }
  throw new Error("Timed out while waiting for the skill usage lock.");
}

async function releaseLock(lock) {
  await lock.close().catch(() => {});
  try {
    const owner = (await fs.readFile(lockFile, "utf8")).trim();
    if (owner === String(process.pid)) {
      await fs.unlink(lockFile);
    }
  } catch {
    // ignore
  }
}

async function loadStats() {
  try {
    const parsed = JSON.parse(await fs.readFile(statsFile, "utf8"));
    if (isRecord(parsed) && isRecord(parsed.skills)) {
      return parsed;
    }
  } catch (error) {
    if (error?.code === "ENOENT") {
      return { version: 2, skills: {} };
    }
    throw error;
  }
  throw new Error("Skill usage data has an invalid format.");
}

async function recordSkillUsage(skillName, filePath) {
  if (!skillName || !String(skillName).trim()) {
    return;
  }
  const key = normalizeSkillName(skillName);
  await fs.mkdir(path.dirname(statsFile), { recursive: true });
  const lock = await acquireLock();
  try {
    const stats = await loadStats();
    stats.version = 2;
    const existing = isRecord(stats.skills[key]) ? stats.skills[key] : {};
    const timestamp = new Date().toISOString();
    const dayKey = localDateKey();
    const paths = Array.isArray(existing.paths) ? existing.paths : [];
    const daily = isRecord(existing.daily) ? { ...existing.daily } : {};
    const dayCount = Number.isSafeInteger(daily[dayKey]) ? daily[dayKey] : 0;
    daily[dayKey] = dayCount + 1;
    stats.skills[key] = {
      count: Number.isSafeInteger(existing.count) ? existing.count + 1 : 1,
      lastUsedAt: timestamp,
      lastSource: "codex",
      paths: filePath && !paths.includes(filePath) ? [...paths, filePath] : paths,
      daily,
    };
    const temporaryFile = `${statsFile}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryFile, `${JSON.stringify(stats, null, 2)}\n`, "utf8");
    await fs.rename(temporaryFile, statsFile);
  } finally {
    await releaseLock(lock);
  }
}

async function readInput() {
  const argumentInput = process.argv.slice(2).join(" ").trim();
  if (argumentInput) {
    return argumentInput;
  }
  return new Promise((resolve) => {
    let buffer = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => {
      buffer += chunk;
    });
    process.stdin.on("end", () => resolve(buffer));
    process.stdin.on("error", () => resolve(""));
  });
}

async function main() {
  try {
    let payload;
    try {
      payload = JSON.parse(sanitizeJsonInput(await readInput()));
    } catch {
      return;
    }
    if (!isRecord(payload)) {
      return;
    }

    const eventName = typeof payload.hook_event_name === "string" ? payload.hook_event_name : "";
    if (eventName === "UserPromptSubmit") {
      for (const name of extractSlashSkillNames(payload.prompt)) {
        await recordSkillUsage(name, undefined);
      }
      return;
    }

    const toolName = typeof payload.tool_name === "string" ? payload.tool_name.trim() : "";
    const inputObj = isRecord(payload.tool_input) ? payload.tool_input : {};

    if (/^skill$/i.test(toolName)) {
      const skillName =
        (typeof inputObj.skill === "string" && inputObj.skill.trim()) ||
        (typeof inputObj.skill_name === "string" && inputObj.skill_name.trim()) ||
        (typeof inputObj.name === "string" && inputObj.name.trim()) ||
        "";
      if (skillName) {
        await recordSkillUsage(skillName, undefined);
      }
      return;
    }

    if (/^(bash|shell_command)$/i.test(toolName)) {
      for (const filePath of extractSkillPathsFromCommand(inputObj.command)) {
        await recordSkillUsage(resolveSkillKey(filePath), filePath);
      }
      return;
    }

    if (!isReadLikeTool(toolName)) {
      return;
    }

    const candidate = extractCandidatePath(payload);
    const filePath = candidate && toLocalPath(candidate);
    if (filePath && isSkillFile(filePath)) {
      await recordSkillUsage(resolveSkillKey(filePath), filePath);
    }
  } catch (error) {
    process.stderr.write(
      `[SkillsManager] Failed to record Codex skill usage: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
  }
}

main();
