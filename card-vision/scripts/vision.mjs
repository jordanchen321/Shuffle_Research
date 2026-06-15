#!/usr/bin/env node
// Cross-platform launcher for the card-vision Python venv.
// One npm script works on macOS, Linux, and Windows by resolving the OS-specific
// interpreter path (env/bin/python vs env/Scripts/python.exe).
//
//   node scripts/vision.mjs install   create the venv + install requirements
//   node scripts/vision.mjs server    run the FastAPI server on 127.0.0.1:8787

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = dirname(dirname(fileURLToPath(import.meta.url))); // card-vision/
const isWindows = process.platform === "win32";
const venvPython = join(ROOT, "env", isWindows ? "Scripts" : "bin", isWindows ? "python.exe" : "python");

// Run a command to completion, inheriting stdio; returns the spawn result.
function runStep(cmd, args) {
  return spawnSync(cmd, args, { stdio: "inherit", cwd: ROOT });
}

// Run a foreground command and exit the process with its status.
function execAndExit(cmd, args) {
  const res = runStep(cmd, args);
  if (res.error) {
    console.error(`Failed to run ${cmd}: ${res.error.message}`);
    process.exit(1);
  }
  process.exit(res.status ?? 1);
}

const task = process.argv[2];

if (task === "install") {
  // Bootstrap the venv with a system Python 3. Try the conventional launcher first, then
  // fall back to `python` for installs (e.g. Microsoft Store) that omit it. Skip a candidate
  // only when it isn't found (ENOENT); a candidate that runs but fails is reported, not masked.
  const candidates = isWindows ? [["py", "-3"], ["python"]] : [["python3"], ["python"]];
  let created = false;
  for (const [cmd, ...flags] of candidates) {
    const res = runStep(cmd, [...flags, "-m", "venv", "env"]);
    if (res.error && res.error.code === "ENOENT") continue; // not installed — try next
    if (res.error || res.status !== 0) {
      console.error(`Failed to create venv with "${[cmd, ...flags].join(" ")}".`);
      process.exit(res.status ?? 1);
    }
    created = true;
    break;
  }
  if (!created) {
    console.error("No Python 3 found on PATH. Install Python 3 (python.org or your package manager) and retry.");
    process.exit(1);
  }
  execAndExit(venvPython, ["-m", "pip", "install", "-r", "requirements.txt"]);
} else if (task === "server") {
  if (!existsSync(venvPython)) {
    console.error(
      `Python venv not found at ${venvPython}.\n` +
        `Run "npm run install-deps" here (or "npm run vision:deps" from csv-card-editor) first.`,
    );
    process.exit(1);
  }
  execAndExit(venvPython, ["-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", "8787"]);
} else {
  console.error(`Unknown task "${task ?? ""}". Use "install" or "server".`);
  process.exit(1);
}
