import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function extractJson(stdout) {
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  for (let index = lines.length - 1; index >= 0; index -= 1) {
    const line = lines[index];
    if (line.startsWith("{") && line.endsWith("}")) {
      return JSON.parse(line);
    }
  }

  throw new Error(`Python command did not return JSON.\n${stdout}`);
}

export async function runPythonJson(args) {
  const { stdout, stderr } = await execFileAsync("python", ["gui_service.py", ...args], {
    cwd: process.cwd(),
    maxBuffer: 50 * 1024 * 1024
  });

  if (stderr && stderr.trim()) {
    console.warn(stderr);
  }

  return extractJson(stdout);
}
