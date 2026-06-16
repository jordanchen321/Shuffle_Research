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
  process.exit(res.signal ? 0 : (res.status ?? 1));
}

// Create the venv and install requirements. Exits the process on failure.
function installDeps() {
  const candidates = isWindows ? [["py", "-3"], ["python"]] : [["python3"], ["python"]];
  let created = false;
  for (const [cmd, ...flags] of candidates) {
    const res = runStep(cmd, [...flags, "-m", "venv", "env"]);
    if (res.error && res.error.code === "ENOENT") continue; // not installed — try next candidate
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
  const res = runStep(venvPython, ["-m", "pip", "install", "-r", "requirements.txt"]);
  if (res.error || res.status !== 0) process.exit(res.status ?? 1);
}

const task = process.argv[2];

if (task === "install") {
  installDeps();
} else if (task === "server") {
  if (!existsSync(venvPython)) {
    console.log("Python venv not found — running install-deps automatically...");
    installDeps();
  } else {
    // Ensure packages are up to date even if the venv was created manually.
    const res = runStep(venvPython, ["-m", "pip", "install", "-r", "requirements.txt", "--quiet"]);
    if (res.error || res.status !== 0) process.exit(res.status ?? 1);
  }
  execAndExit(venvPython, ["-m", "uvicorn", "server:app", "--host", "127.0.0.1", "--port", "8787"]);
} else {
  console.error(`Unknown task "${task ?? ""}". Use "install" or "server".`);
  process.exit(1);
}
