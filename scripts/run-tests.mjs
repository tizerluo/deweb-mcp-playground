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
      "src/lib/i18n.test.ts",
      "src/lib/jev/protocol.test.ts",
      "src/lib/jev/rows.test.ts",
      "src/lib/jev/stats.test.ts",
      "src/lib/tape/failure.test.ts",
      "src/lib/tape/rpc.test.ts",
      "src/lib/jev/server-only.test.ts",
      "src/lib/jev/snake/engine.test.ts",
      "src/lib/jev/snake/analysis.test.ts",
      "src/lib/jev/snake/controller.test.ts",
      "src/lib/jev/snake/loop.test.ts",
      "src/lib/jev/car/track.test.ts",
      "src/lib/jev/car/engine.test.ts",
      "src/lib/jev/car/candidates.test.ts",
      "src/lib/jev/car/question.test.ts",
      "src/lib/jev/car/controller.test.ts",
      "src/lib/jev/car/loop.test.ts",
      "src/lib/jev/car/view.test.ts",
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
