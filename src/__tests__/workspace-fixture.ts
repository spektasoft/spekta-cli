import fs from "fs-extra";
import os from "node:os";
import path from "node:path";
import { execa } from "execa";
import { refreshPaths } from "../core/config/paths";
import { resetInternalState } from "../core/config";

export async function createWorkspaceFixture() {
  const base = await fs.mkdtemp(path.join(os.tmpdir(), "spekta-boundary-"));
  const repo = path.join(base, "repo");
  const root = path.join(repo, "work");
  const outside = path.join(base, "outside");
  const ambient = path.join(base, "ambient");
  const home = path.join(base, "home");
  const assets = path.join(base, "assets");
  const alias = path.join(base, "workspace-link");
  const originalCwd = process.cwd();
  const keys = [
    "SPEKTA_HOME_OVERRIDE",
    "SPEKTA_ASSET_ROOT_OVERRIDE",
    "SPEKTA_READ_TOKEN_LIMIT",
    "SPEKTA_GREP_TOKEN_LIMIT",
    "SPEKTA_COMPACT_THRESHOLD",
    "RIPGREP_CONFIG_PATH",
  ] as const;
  const previous = new Map(keys.map((key) => [key, process.env[key]]));
  for (const dir of [root, outside, ambient, home, assets])
    await fs.ensureDir(dir);
  await fs.ensureDir(path.join(assets, "tools"));
  await fs.writeFile(path.join(assets, "default.ignore"), "managed.txt\n");
  await fs.writeFile(path.join(home, ".spektaignore"), "global.txt\n");
  await execa("git", ["init", "--quiet"], { cwd: repo });
  await execa("git", ["init", "--quiet"], { cwd: ambient });
  const contents: Record<string, string> = {
    "real.txt": "needle INTERNAL\nsecond line\n",
    "..notes": "needle DOTS\n",
    "with space.txt": "needle SPACE\n",
    "-file.txt": "needle DASH\n",
    "-": "-needle LITERAL_DASH\n",
    "ignored.txt": "needle SPEKTA_IGNORED\n",
    "git-ignored.txt": "needle GIT_IGNORED\n",
    "allowed.txt": "needle WHITELISTED\n",
    "managed.txt": "needle MANAGED_IGNORED\n",
    "global.txt": "needle GLOBAL_IGNORED\n",
    ".env": "needle RESTRICTED_ENV\n",
    ".gitignore": "git-ignored.txt\nallowed.txt\n# needle RESTRICTED_GIT\n",
    ".spektaignore": "ignored.txt\n!allowed.txt\n# needle RESTRICTED_SPEKTA\n",
    "safe/child.txt": "needle CHILD\n",
    "hidden-tree/.gitignore": "*\n",
    "hidden-tree/secret.txt": "needle NESTED_IGNORED\n",
  };
  for (const [file, content] of Object.entries(contents))
    await fs.outputFile(path.join(root, file), content);
  await fs.writeFile(path.join(repo, "sibling.txt"), "needle SIBLING\n");
  await fs.writeFile(path.join(outside, "secret.txt"), "needle EXTERNAL\n");
  await fs.writeFile(path.join(ambient, "real.txt"), "needle WRONG_CWD\n");
  await fs.writeFile(path.join(ambient, ".gitignore"), "real.txt\n");
  await fs.writeFile(path.join(ambient, ".spektaignore"), "real.txt\n");
  await fs.symlink(root, alias, "dir");
  for (const [name, target, type] of [
    ["internal-file.txt", path.join(root, "real.txt"), "file"],
    ["internal-dir", path.join(root, "safe"), "dir"],
    ["external-file.txt", path.join(outside, "secret.txt"), "file"],
    ["external-dir", outside, "dir"],
    ["hop", path.join(root, "external-dir"), "dir"],
    ["ignored-alias.txt", path.join(root, "ignored.txt"), "file"],
    ["dangling.txt", path.join(outside, "missing.txt"), "file"],
    ["cycle-a", path.join(root, "cycle-b"), "file"],
    ["cycle-b", path.join(root, "cycle-a"), "file"],
  ] as const)
    await fs.symlink(target, path.join(root, name), type);
  for (const name of [".env", ".gitignore", ".spektaignore"])
    await fs.symlink(
      path.join(root, name),
      path.join(root, `alias${name}.txt`),
      "file",
    );
  process.env.SPEKTA_HOME_OVERRIDE = home;
  process.env.SPEKTA_ASSET_ROOT_OVERRIDE = assets;
  process.env.SPEKTA_READ_TOKEN_LIMIT = "1000";
  process.env.SPEKTA_GREP_TOKEN_LIMIT = "10000";
  process.env.SPEKTA_COMPACT_THRESHOLD = "1000000";
  delete process.env.RIPGREP_CONFIG_PATH;
  refreshPaths();
  resetInternalState();
  return {
    base,
    repo,
    root,
    outside,
    ambient,
    home,
    assets,
    alias,
    async cleanup() {
      process.chdir(originalCwd);
      for (const [key, value] of previous) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
      refreshPaths();
      resetInternalState();
      await fs.remove(base);
    },
  };
}
export type WorkspaceFixture = Awaited<
  ReturnType<typeof createWorkspaceFixture>
>;
