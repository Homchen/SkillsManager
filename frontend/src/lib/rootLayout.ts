/** Whether the skills page should prompt to elevate and migrate hub-root skills. */
export function shouldPromptRootLayoutMigrate(opts: {
  skills: Array<{rootLayout?: boolean}>
  elevated: boolean
  skippedThisSession: boolean
}): boolean {
  if (opts.elevated || opts.skippedThisSession) {
    return false
  }
  return opts.skills.some((skill) => skill.rootLayout)
}

export function rootLayoutSkillCount(skills: Array<{rootLayout?: boolean}>): number {
  let n = 0
  for (const skill of skills) {
    if (skill.rootLayout) n++
  }
  return n
}
