import { mkdir } from "node:fs/promises";
import { spawn } from "node:child_process";

await mkdir("bin", { recursive: true });

const go = process.platform === "win32" ? "go.exe" : "go";
const output =
  process.platform === "win32"
    ? "bin/multica-wails.exe"
    : "bin/multica-wails";
const child = spawn(go, ["build", "-o", output, "."], {
  stdio: "inherit",
});

child.once("error", (error) => {
  console.error(error);
  process.exitCode = 1;
});
child.once("exit", (code, signal) => {
  if (signal) {
    console.error(`go build exited from signal ${signal}`);
    process.exitCode = 1;
    return;
  }
  process.exitCode = code ?? 1;
});
