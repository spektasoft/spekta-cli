import fs from "fs-extra";
import os from "os";
import path from "path";
import { vi } from "vitest";
import { execa } from "execa";

export function createProxyFixture(options: {
  prefix: string;
  stdout: string;
}) {
  let fixture: string | undefined;
  let savedExitCode: typeof process.exitCode;
  let savedTtyDescriptor: PropertyDescriptor | undefined;

  function setup(): { fixture: string; workspace: string } {
    vi.resetAllMocks();
    savedExitCode = process.exitCode;
    savedTtyDescriptor = Object.getOwnPropertyDescriptor(
      process.stdin,
      "isTTY",
    );
    process.exitCode = undefined;
    fixture = fs.mkdtempSync(path.join(os.tmpdir(), options.prefix));
    const workspace = path.join(fixture, "workspace");
    fs.ensureDirSync(path.join(workspace, "directory"));
    fs.ensureDirSync(path.join(workspace, ".env"));
    fs.ensureDirSync(path.join(fixture, "outside"));
    fs.writeFileSync(path.join(workspace, "file.txt"), "file");
    fs.symlinkSync(
      path.join(fixture, "outside"),
      path.join(workspace, "escape"),
      "dir",
    );
    fs.symlinkSync(
      path.join(workspace, ".env"),
      path.join(workspace, "restricted-alias"),
      "dir",
    );
    fs.symlinkSync(
      path.join(workspace, "missing"),
      path.join(workspace, "dangling"),
      "dir",
    );
    vi.spyOn(process, "cwd").mockReturnValue(workspace);
    vi.spyOn(console, "log").mockImplementation(() => undefined);
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(execa).mockResolvedValue({
      stdout: options.stdout,
      stderr: "",
      exitCode: 0,
    } as never);
    return { fixture, workspace };
  }

  function teardown(): void {
    vi.restoreAllMocks();
    process.exitCode = savedExitCode;
    if (savedTtyDescriptor) {
      Object.defineProperty(process.stdin, "isTTY", savedTtyDescriptor);
    } else {
      Reflect.deleteProperty(process.stdin, "isTTY");
    }
    if (fixture) fs.removeSync(fixture);
    fixture = undefined;
  }

  return { setup, teardown };
}
