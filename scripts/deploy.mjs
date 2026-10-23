import { chmod } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { join } from "node:path";
import process from "node:process";

const npmCli = process.env.npm_execpath;
if (!npmCli) {
  console.error("Run this script through `npm run deploy`.");
  process.exitCode = 1;
} else {
  if (process.platform !== "win32") {
    await Promise.all(
      ["index.js", "codex-hook.js"].map((entry) =>
        chmod(join("dist", entry), 0o755),
      ),
    );
  }

  const result = spawnSync(process.execPath, [npmCli, "link", "."], {
    stdio: "inherit",
  });
  if (result.error) {
    console.error(`Could not run npm link: ${result.error.message}`);
    process.exitCode = 1;
  } else {
    process.exitCode = result.status ?? 1;
  }
}
