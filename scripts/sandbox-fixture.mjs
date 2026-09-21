/**
 * Sandbox fixtures: the files the authoring sandbox has and a public clone
 * does not.
 *
 * `.grok/` (skills, `app-env.json`) and `AGENTS.md` are the agent scaffolding
 * this app is built with; they are gitignored or intentionally not published,
 * so a fresh clone is missing them. Tests that read them are about the
 * sandbox's own contract (the og skill's prose, the auth flag it ships) and
 * cannot check anything without them: they skip with the missing paths named
 * instead of failing, and behave exactly as before wherever the files exist.
 *
 * `cleanWorkspace()` is the other half: an empty directory for tests whose
 * assertions are the platform's *defaults*. The platform head injector reads
 * `src/lib/og/site.json` and `public/og.jpg` from its `cwd`, and this repo
 * ships both (the app's own card and title), so a test that means "no custom
 * card and no site title" has to say so by passing a workspace that has
 * neither — otherwise the app's own identity silently decides the result.
 */
import { existsSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/** Relative paths of the sandbox-only files tests depend on. */
export const SANDBOX_FILES = {
  /** Sign-in flag carrier read by `scripts/with-app-env.mjs`. */
  appEnv: ".grok/app-env.json",
  /** The og skill's prose and its card recipes (doc-pinning tests read these). */
  ogSkill: ".grok/skills/og/SKILL.md",
  ogSkillReferences: ".grok/skills/og/references",
  /** Sandbox agent instructions (the execution-loop contract). */
  agentsDoc: "AGENTS.md",
  /** Platform-served PWA assets the middleware and install page point at. */
  platformIcon: "public/__grok/icon-180.png",
  platformInstallStyles: "public/__grok/install/styles.css",
};

/** Which of `required` (root-relative) are absent under `root`. */
export function missingSandboxFiles(root, required) {
  return required.filter((rel) => !existsSync(join(root, rel)));
}

/**
 * The `skip` value for a `node:test` options object: `false` (run the test)
 * when every fixture is present, otherwise the reason naming what is missing.
 */
export function sandboxSkip(root, required, note = "") {
  const missing = missingSandboxFiles(root, required);
  if (missing.length === 0) return false;
  return `${note ? `${note}: ` : ""}sandbox fixture missing: ${missing.join(", ")}`;
}

let clean = null;

/** An empty workspace root, so platform defaults are not shadowed by this app's own files. */
export function cleanWorkspace() {
  clean ??= mkdtempSync(join(tmpdir(), "sandbox-clean-"));
  return clean;
}
