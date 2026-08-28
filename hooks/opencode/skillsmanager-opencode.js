import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const usageDir = path.join(os.homedir(), ".skillsmanager", "skills");
const usagePath = path.join(usageDir, "skill-usage.json");
const lockPath = `${usagePath}.lock`;
const lockTimeoutMs = 2_000;
const staleLockMs = 10_000;

function isSkillFile(filePath) {
  return typeof filePath === "string" && /(?:^|[\\/])SKILL\.md$/i.test(filePath);
}

function skillID(filePath) {
  const skillDir = path.dirname(filePath);
  const skillIDCandidate = path.basename(path.dirname(skillDir));
  const translationRoot = path.basename(path.dirname(path.dirname(skillDir)));
  return translationRoot === "skills_translation" ? skillIDCandidate : path.basename(skillDir);
}

function localDateKey() {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

async function sleep(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function acquireLock() {
  const deadline = Date.now() + lockTimeoutMs;
  while (Date.now() < deadline) {
    try {
      const handle = await fs.open(lockPath, "wx");
      try {
        await handle.writeFile(String(process.pid), "utf8");
      } catch {
        // pid is best-effort
      }
      return handle;
    } catch (error) {
      if (error && typeof error === "object" && error.code !== "EEXIST") throw error;
      try {
        const lockInfo = await fs.stat(lockPath);
        let stale = Date.now() - lockInfo.mtimeMs > staleLockMs;
        if (!stale) {
          try {
            const owner = Number((await fs.readFile(lockPath, "utf8")).trim());
            if (Number.isInteger(owner) && owner > 0) {
              try {
                process.kill(owner, 0);
              } catch {
                stale = true;
              }
            }
          } catch {
            // unreadable lock
          }
        }
        if (stale) {
          await fs.rm(lockPath, { force: true });
          continue;
        }
      } catch (lockError) {
        if (!lockError || typeof lockError !== "object" || lockError.code !== "ENOENT") {
          throw lockError;
        }
      }
      await sleep(25);
    }
  }
  throw new Error("Timed out waiting to record skill usage.");
}

async function releaseLock(lock) {
  await lock.close().catch(() => {});
  try {
    const owner = (await fs.readFile(lockPath, "utf8")).trim();
    if (owner === String(process.pid)) {
      await fs.rm(lockPath, { force: true });
    }
  } catch {
    // ignore
  }
}

async function loadUsage() {
  try {
    const parsed = JSON.parse(await fs.readFile(usagePath, "utf8"));
    if (parsed && typeof parsed === "object" && parsed.skills && typeof parsed.skills === "object") {
      return parsed;
    }
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return { version: 2, skills: {} };
    }
    throw error;
  }
  return { version: 2, skills: {} };
}

async function recordSkillUsage(id, filePath) {
  if (!id || !String(id).trim()) return;
  await fs.mkdir(usageDir, { recursive: true });
  const lock = await acquireLock();
  try {
    const usage = await loadUsage();
    const key = String(id).trim().replace(/^[/\$]+/, "");
    const existing = usage.skills[key] && typeof usage.skills[key] === "object" ? usage.skills[key] : {};
    const daily = existing.daily && typeof existing.daily === "object" ? existing.daily : {};
    const paths = Array.isArray(existing.paths) ? existing.paths : [];
    const day = localDateKey();
    daily[day] = Number.isSafeInteger(daily[day]) ? daily[day] + 1 : 1;
    usage.version = 2;
    usage.skills[key] = {
      count: Number.isSafeInteger(existing.count) ? existing.count + 1 : 1,
      lastUsedAt: new Date().toISOString(),
      paths: filePath && !paths.includes(filePath) ? [...paths, filePath] : paths,
      daily,
    };
    const temporaryPath = `${usagePath}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(temporaryPath, `${JSON.stringify(usage, null, 2)}\n`, "utf8");
    await fs.rename(temporaryPath, usagePath);
  } finally {
    await releaseLock(lock);
  }
}

async function recordSkillRead(filePath) {
  await recordSkillUsage(skillID(filePath), filePath);
}

export default async function skillsManagerOpenCodePlugin() {
  return {
    "tool.execute.before": async (input, output) => {
      try {
        const tool = String(input?.tool || "").toLowerCase();
        const args = output?.args && typeof output.args === "object" ? output.args : {};
        if (tool === "skill" || tool === "skill_use" || tool === "skills") {
          const name = args.name || args.skill || args.skill_name;
          if (name) await recordSkillUsage(String(name));
          return;
        }
        const filePath = args.filePath || args.path;
        if (tool === "read" && isSkillFile(filePath)) {
          await recordSkillRead(filePath);
        }
      } catch (error) {
        console.error(
          `[SkillsManager] Failed to record OpenCode skill usage: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    },
  };
}
