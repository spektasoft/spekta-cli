import fs from "fs-extra";
import os from "os";
import path from "path";
import { execa } from "execa";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import { runRtkProxy } from "./proxy";
import { TOOL_REGISTRY } from "../../api/mcp-server/registry";

const backendTestsEnabled = process.env.SPEKTA_FIND_BACKEND_TESTS === "1";
const describeBackend = backendTestsEnabled ? describe : describe.skip;
const backendSuiteName =
  "restricted find with real RTK and GNU Findutils" +
  (backendTestsEnabled ? "" : " (opt-in: run npm run test:find-backend)");

const reviewedRtkVersions = new Set(["0.46.0", "0.49.0", "0.50.0"]);

let fixture = "";
let workspace = "";
let savedExitCode: typeof process.exitCode;

const expectedTypeScriptFiles = [
  "./root.ts",
  "./space name/file name.ts",
  "./src/deep/deep.ts",
  "./src/nested.ts",
].sort();

function consoleText(): string {
  return vi
    .mocked(console.log)
    .mock.calls.map(([value]) => String(value))
    .join("\n");
}

function responseText(
  response: Awaited<ReturnType<typeof TOOL_REGISTRY.spekta_shell.handler>>,
): string {
  return response.content
    .map((block) => ("text" in block ? String(block.text) : ""))
    .join("\n");
}

function outputLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .filter((line) => line !== "")
    .sort();
}

async function expectDiscovery(
  args: string[],
  expectedFiles: string[],
): Promise<void> {
  const original = [...args];

  await runRtkProxy("find", args);
  const mcp = await TOOL_REGISTRY.spekta_shell.handler({
    command: "find",
    args,
  });

  const cli = consoleText();
  const mcpText = responseText(mcp);

  expect(console.error).not.toHaveBeenCalled();
  expect(process.exitCode).toBeUndefined();
  expect(mcp.isError).toBe(false);
  expect(outputLines(mcpText)).toEqual([...expectedFiles].sort());

  for (const file of expectedFiles) {
    expect(cli).toContain(file);
  }

  expect(cli).not.toContain("outside-only.ts");
  expect(mcpText).not.toContain("outside-only.ts");
  expect(args).toEqual(original);

  expect(
    fs.readFileSync(path.join(fixture, "outside", "outside-only.ts"), "utf8"),
  ).toBe("external sentinel");
}

describeBackend(backendSuiteName, () => {
  beforeAll(async () => {
    if (process.platform !== "linux") {
      throw new Error(
        "Selected find backend tests require Linux or WSL with GNU Findutils.",
      );
    }

    const versionResult = await execa("rtk", ["--version"], {
      reject: false,
      timeout: 10_000,
    });

    if (versionResult.exitCode !== 0) {
      throw new Error(
        `Unable to identify RTK: ${versionResult.stderr || versionResult.stdout}`,
      );
    }

    const version = versionResult.stdout.match(/\b(\d+\.\d+\.\d+)\b/)?.[1];

    if (version === undefined || !reviewedRtkVersions.has(version)) {
      throw new Error(
        [
          `RTK version '${version ?? "unknown"}' has not been reviewed for this suite.`,
          `Use RTK ${[...reviewedRtkVersions].join(", ")}.`,
          "Review another release's proxy implementation before extending the reviewed-version list.",
        ].join(" "),
      );
    }

    // This is a backend capability probe inside the selected test suite.
    // It is not a request routed through Spekta's public find grammar.
    const findVersion = await execa("rtk", ["proxy", "find", "--version"], {
      reject: false,
      timeout: 10_000,
    });

    if (
      findVersion.exitCode !== 0 ||
      !findVersion.stdout.includes("GNU findutils")
    ) {
      throw new Error(
        [
          "RTK proxy must resolve GNU Findutils find.",
          "Native Windows find.exe and unverified find implementations are unsupported.",
          findVersion.stderr || findVersion.stdout,
        ].join(" "),
      );
    }
  }, 30_000);

  beforeEach(() => {
    fixture = "";
    workspace = "";

    savedExitCode = process.exitCode;
    process.exitCode = undefined;

    fixture = fs.mkdtempSync(path.join(os.tmpdir(), "spekta-find-backend-"));
    workspace = path.join(fixture, "workspace");

    fs.ensureDirSync(path.join(workspace, "src", "deep"));
    fs.ensureDirSync(path.join(workspace, "space name"));
    fs.ensureDirSync(path.join(workspace, ".env"));
    fs.ensureDirSync(path.join(fixture, "outside"));

    fs.writeFileSync(path.join(workspace, "root.ts"), "root");
    fs.writeFileSync(path.join(workspace, "root.js"), "nonmatching");
    fs.writeFileSync(path.join(workspace, "plain.txt"), "nonmatching");
    fs.writeFileSync(path.join(workspace, "-exec"), "literal filename");
    fs.writeFileSync(path.join(workspace, "src", "nested.ts"), "nested");
    fs.writeFileSync(path.join(workspace, "src", "deep", "deep.ts"), "deep");
    fs.writeFileSync(
      path.join(workspace, "space name", "file name.ts"),
      "spaces",
    );
    fs.writeFileSync(
      path.join(workspace, ".env", "visible.ts"),
      "explicit roots only",
    );
    fs.writeFileSync(
      path.join(fixture, "outside", "outside-only.ts"),
      "external sentinel",
    );

    fs.symlinkSync(
      path.join(fixture, "outside"),
      path.join(workspace, "escape"),
      "dir",
    );
    fs.symlinkSync(
      path.join(workspace, "src"),
      path.join(workspace, "internal-alias"),
      "dir",
    );

    // The production find invocation supplies this cwd explicitly.
    // Do not use process.chdir in a Vitest worker thread.
    vi.spyOn(process, "cwd").mockReturnValue(workspace);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    process.exitCode = savedExitCode;

    if (fixture !== "") {
      fs.removeSync(fixture);
    }

    fixture = "";
    workspace = "";
  });

  it.each([
    { args: [".", "-type", "f", "-name", "*.ts"] },
    { args: ["-type", "f", "-name", "*.ts"] },
    { args: [".", "-name", "*.ts", "-type", "f"] },
    { args: [".", "-type", "f", "-name", "*.ts", "-print"] },
  ])(
    "returns only matching workspace files for $args through both adapters",
    async ({ args }) => {
      await expectDiscovery(args, expectedTypeScriptFiles);

      expect(consoleText()).not.toContain("root.js");
      expect(consoleText()).not.toContain("plain.txt");
      expect(consoleText()).not.toContain("escape/outside-only.ts");
      expect(consoleText()).not.toContain("internal-alias/nested.ts");
    },
    30_000,
  );

  it("resolves an explicit directory root from the workspace", async () => {
    await expectDiscovery(
      ["src", "-type", "f", "-name", "*.ts"],
      ["src/deep/deep.ts", "src/nested.ts"],
    );
  }, 30_000);

  it("preserves a pattern containing spaces", async () => {
    await expectDiscovery(
      [".", "-type", "f", "-name", "file name.ts"],
      ["./space name/file name.ts"],
    );
  }, 30_000);

  it("treats an action-looking name value as a literal pattern", async () => {
    await expectDiscovery([".", "-type", "f", "-name", "-exec"], ["./-exec"]);
    expect(fs.existsSync(path.join(workspace, "marker"))).toBe(false);
  }, 30_000);

  it("treats a restricted-looking name as a filter rather than a root", async () => {
    await expectDiscovery([".", "-type", "d", "-name", ".env"], []);
  }, 30_000);

  it("does not traverse a contained directory symlink supplied as the root", async () => {
    await runRtkProxy("find", [
      "internal-alias",
      "-type",
      "f",
      "-name",
      "*.ts",
    ]);

    const mcp = await TOOL_REGISTRY.spekta_shell.handler({
      command: "find",
      args: ["internal-alias", "-type", "f", "-name", "*.ts"],
    });

    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
    expect(mcp.isError).toBe(false);
    expect(responseText(mcp)).toBe("");
    expect(consoleText()).not.toContain("nested.ts");
    expect(consoleText()).not.toContain("deep.ts");
  }, 30_000);

  it("supports omitted arguments and default printing without following child links", async () => {
    await runRtkProxy("find", []);
    const mcp = await TOOL_REGISTRY.spekta_shell.handler({ command: "find" });

    const cli = consoleText();
    const mcpText = responseText(mcp);
    const lines = outputLines(mcpText);

    expect(console.error).not.toHaveBeenCalled();
    expect(process.exitCode).toBeUndefined();
    expect(mcp.isError).toBe(false);
    expect(lines).toContain(".");
    expect(lines).toContain("./root.ts");
    expect(lines).toContain("./root.js");
    expect(lines).not.toContain("./escape");
    expect(lines).toContain("./internal-alias");
    expect(cli).not.toContain("outside-only.ts");
    expect(mcpText).not.toContain("outside-only.ts");
    expect(lines).not.toContain("./internal-alias/nested.ts");
    expect(lines).not.toContain("./internal-alias/deep/deep.ts");
  }, 30_000);
});
