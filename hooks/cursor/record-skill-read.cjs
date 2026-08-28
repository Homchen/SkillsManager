const fs = require("node:fs/promises");
const os = require("node:os");
const path = require("node:path");
const { fileURLToPath } = require("node:url");

/** Dual-hook (beforeReadFile + preToolUse) window for the same Read. */
const dualHookDedupMs = 2_500;

/** Slash skill ids: /grill-with-docs, /create-hook, … */
const slashSkillRe = /(?:^|[\s])[/$]([a-z0-9]+(?:-[a-z0-9]+)*)(?![/\w])/gi;

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

/**
 * Resolve a file path from Cursor hook payloads.
 * Supports beforeReadFile (`file_path`) and preToolUse (`tool_input.path`).
 * Does not recurse into `content` (full file body) to avoid false matches.
 */
function extractCandidatePath(payload) {
  if (!isRecord(payload)) {
    return undefined;
  }

  const topKeys = ["file_path", "filePath", "target_file", "targetFile"];
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

  if (typeof payload.path === "string" && payload.path.trim()) {
    return payload.path;
  }

  return undefined;
}

function eventSource(payload) {
  if (!isRecord(payload)) {
    return "unknown";
  }

  const name = typeof payload.hook_event_name === "string" ? payload.hook_event_name : "";
  if (name === "beforeReadFile" || name === "preToolUse" || name === "beforeSubmitPrompt") {
    return name;
  }

  if (typeof payload.tool_name === "string" || isRecord(payload.tool_input)) {
    return "preToolUse";
  }

  if (typeof payload.prompt === "string") {
    return "beforeSubmitPrompt";
  }

  if (typeof payload.file_path === "string") {
    return "beforeReadFile";
  }

  return "unknown";
}

function isReadToolPayload(payload) {
  if (!isRecord(payload)) {
    return true;
  }

  if (typeof payload.tool_name !== "string") {
    return true;
  }

  return /^read$/i.test(payload.tool_name.trim());
}

function toLocalPath(candidate) {
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
  return /(?:^|[\\/])SKILL\.md$/i.test(filePath);
}

/**
 * Resolve the usage key for a SKILL.md path.
 * Hub / tool copies: parent folder name (skill id).
 * Translation versions: skills_translation/<skill-id>/<lang>/SKILL.md → skill id.
 */
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
  return names;
}

/**
 * Collect skill targets from beforeSubmitPrompt (slash invoke + SKILL.md attachments).
 * Returns unique entries keyed by skill id; prefers an entry that has a file path.
 */
function extractSubmitSkillTargets(payload) {
  const byName = new Map();

  const remember = (skillName, filePath) => {
    const name = normalizeSkillName(skillName);
    if (!name) {
      return;
    }
    const existing = byName.get(name);
    if (!existing || (!existing.filePath && filePath)) {
      byName.set(name, { name, filePath });
    }
  };

  for (const name of extractSlashSkillNames(payload.prompt)) {
    remember(name, undefined);
  }

  if (Array.isArray(payload.attachments)) {
    for (const attachment of payload.attachments) {
      if (!isRecord(attachment)) {
        continue;
      }
      const rawPath =
        (typeof attachment.file_path === "string" && attachment.file_path.trim()) ||
        (typeof attachment.filePath === "string" && attachment.filePath.trim()) ||
        "";
      const filePath = rawPath ? toLocalPath(rawPath) : undefined;
      if (filePath && isSkillFile(filePath)) {
        remember(resolveSkillKey(filePath), filePath);
      }
    }
  }

  return [...byName.values()];
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

function sanitizeJsonInput(input) {
  return input.replace(/^(?:\uFEFF|\u200B)+/, "");
}

function writeHookResponse(eventName) {
  if (eventName === "beforeSubmitPrompt") {
    process.stdout.write('{"continue":true}\n');
    return;
  }
  process.stdout.write('{"permission":"allow"}\n');
}

function isDualHookDuplicate(existing, source) {
  if (!isRecord(existing) || typeof existing.lastUsedAt !== "string") {
    return false;
  }

  const lastSource = typeof existing.lastSource === "string" ? existing.lastSource : "";
  if (!lastSource || lastSource === source || lastSource === "unknown" || source === "unknown") {
    return false;
  }

  const lastMs = Date.parse(existing.lastUsedAt);
  if (!Number.isFinite(lastMs)) {
    return false;
  }

  return Date.now() - lastMs <= dualHookDedupMs;
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

async function recordSkillUsage(skillName, filePath, source) {
  const key = normalizeSkillName(skillName);
  if (!key) {
    return;
  }

  await fs.mkdir(path.dirname(statsFile), { recursive: true });
  const lock = await acquireLock();

  try {
    const stats = await loadStats();
    stats.version = 2;
    const existing = isRecord(stats.skills[key]) ? stats.skills[key] : {};

    if (isDualHookDuplicate(existing, source)) {
      return;
    }

    const timestamp = new Date().toISOString();
    const dayKey = localDateKey();
    const paths = Array.isArray(existing.paths) ? existing.paths : [];
    const daily = isRecord(existing.daily) ? { ...existing.daily } : {};
    const dayCount = Number.isSafeInteger(daily[dayKey]) ? daily[dayKey] : 0;
    daily[dayKey] = dayCount + 1;

    stats.skills[key] = {
      count: Number.isSafeInteger(existing.count) ? existing.count + 1 : 1,
      lastUsedAt: timestamp,
      lastSource: source,
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

async function recordSkillRead(filePath, source) {
  await recordSkillUsage(resolveSkillKey(filePath), filePath, source);
}

async function main() {
  let responseEvent = "unknown";

  try {
    const argumentInput = process.argv.slice(2).join(" ").trim();
    const input = await new Promise((resolve) => {
      if (argumentInput) {
        resolve(argumentInput);
        return;
      }

      let buffer = "";
      process.stdin.setEncoding("utf8");
      process.stdin.on("data", (chunk) => {
        buffer += chunk;
      });
      process.stdin.on("end", () => resolve(buffer));
      process.stdin.on("error", () => resolve(""));
    });

    let payload;
    try {
      payload = JSON.parse(sanitizeJsonInput(input));
    } catch {
      return;
    }

    if (!isRecord(payload)) {
      return;
    }

    responseEvent = eventSource(payload);
    const eventName =
      typeof payload.hook_event_name === "string" ? payload.hook_event_name : responseEvent;

    if (eventName === "beforeSubmitPrompt") {
      const targets = extractSubmitSkillTargets(payload);
      for (const target of targets) {
        await recordSkillUsage(target.name, target.filePath, "beforeSubmitPrompt");
      }
      return;
    }

    if (!isReadToolPayload(payload)) {
      return;
    }

    const candidate = extractCandidatePath(payload);
    const filePath = candidate && toLocalPath(candidate);
    if (filePath && isSkillFile(filePath)) {
      await recordSkillRead(filePath, eventSource(payload));
    }
  } catch (error) {
    // Usage analytics must never prevent the original agent operation.
    process.stderr.write(
      `[SkillsManager] Failed to record skill usage: ${
        error instanceof Error ? error.message : String(error)
      }\n`,
    );
  } finally {
    writeHookResponse(responseEvent);
  }
}

main();
