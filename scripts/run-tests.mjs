#!/usr/bin/env node
/**
 * Run every test suite and report one exit status.
 *
 * `npm test` used to chain the two suites with `&&`: when the scripts suite
 * went red the src suite never ran at all, so a red src suite could hide
 * behind it — the exact failure mode a green `npm test` is supposed to rule
 * out. Both suites always execute now; the process still exits non-zero when
 * either one failed.
 */
import { spawnSync } from "node:child_process";

const SUITES = [
  ["scripts", ["--test", "scripts/**/*.test.mjs"]],
  [
    "src",
    [
      "--experimental-strip-types",
      "--test",
      "src/lib/app-data/app-data.test.ts",
      "src/lib/app-data/readiness-schedule.test.ts",
      "src/lib/auth/gate-identity.test.ts",
      "src/lib/auth/sign-in-gate.test.ts",
    ],
  ],
];

let status = 0;
for (const [name, args] of SUITES) {
  console.log(`\n[run-tests] ${name}: node ${args.join(" ")}`);
  const result = spawnSync(process.execPath, args, { stdio: "inherit" });
  // A signal-killed child has no status: never report that as success.
  const code = result.status ?? 1;
  console.log(`[run-tests] ${name} exited ${code}`);
  if (code !== 0 && status === 0) status = code;
}
process.exit(status);
