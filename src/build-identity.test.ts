import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { build } from "vite";
import { afterEach, expect, it } from "vitest";
import { buildMetadataPlugin } from "./build-metadata";

const fixtures: string[] = [];
afterEach(async () => {
  await Promise.all(
    fixtures
      .splice(0)
      .map((root) => rm(root, { recursive: true, force: true })),
  );
});

it("embeds version and explicitly unknown source provenance when building outside Git", async () => {
  const root = await mkdtemp(join(tmpdir(), "spekta-build-"));
  fixtures.push(root);
  await writeFile(
    join(root, "package.json"),
    JSON.stringify({ version: "2.3.4" }),
  );
  await writeFile(
    join(root, "entry.js"),
    "console.log(JSON.stringify(__SPEKTA_BUILD_METADATA__));",
  );
  await build({
    configFile: false,
    root,
    logLevel: "silent",
    plugins: [buildMetadataPlugin(root)],
    build: {
      lib: {
        entry: join(root, "entry.js"),
        formats: ["es"],
        fileName: () => "index.js",
      },
      minify: false,
    },
  });
  const output = execFileSync(
    process.execPath,
    [join(root, "dist", "index.js")],
    { encoding: "utf8" },
  );
  expect(JSON.parse(output)).toEqual({
    version: "2.3.4",
    sourceRevision: "unknown",
    sourceState: "unknown",
  });
});

it("captures the build checkout revision and distinguishes clean from modified source", async () => {
  const root = await mkdtemp(join(tmpdir(), "spekta-build-"));
  fixtures.push(root);
  const checkout = join(root, "checkout");
  // Reuse existing commits in an isolated fixture; no commits are created.
  execFileSync(
    "git",
    ["clone", "--quiet", "--shared", process.cwd(), checkout],
    { stdio: "ignore" },
  );
  const revision = execFileSync("git", ["-C", checkout, "rev-parse", "HEAD"], {
    encoding: "utf8",
  }).trim();
  await writeFile(
    join(root, "entry.js"),
    "console.log(JSON.stringify(__SPEKTA_BUILD_METADATA__));",
  );
  for (const sourceState of ["clean", "modified"]) {
    if (sourceState === "modified") {
      const packagePath = join(checkout, "package.json");
      await writeFile(packagePath, `${await readFile(packagePath, "utf8")}\n`);
    }
    await build({
      configFile: false,
      root,
      logLevel: "silent",
      plugins: [buildMetadataPlugin(checkout)],
      build: {
        lib: {
          entry: join(root, "entry.js"),
          formats: ["es"],
          fileName: () => "index.js",
        },
        minify: false,
      },
    });
    const output = execFileSync(
      process.execPath,
      [join(root, "dist", "index.js")],
      { encoding: "utf8" },
    );
    expect(JSON.parse(output)).toMatchObject({
      sourceRevision: revision,
      sourceState,
    });
  }
});
