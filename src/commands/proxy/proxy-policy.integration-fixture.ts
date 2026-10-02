import fs from "fs-extra";
import path from "path";
import { createProxyFixture } from "./proxy-mocked.integration-fixture";

export function createGitPolicyFixture() {
  const fixture = createProxyFixture({
    prefix: "spekta-proxy-integration-",
    stdout: "listing",
  });
  let savedGitOverrides: Record<string, string | undefined>;

  function setup(): { fixture: string; workspace: string } {
    savedGitOverrides = {};
    for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_COMMON_DIR"]) {
      savedGitOverrides[key] = process.env[key];
      delete process.env[key];
    }
    const context = fixture.setup();
    for (const name of [".gitignore", ".spektaignore", ".git"]) {
      fs.ensureDirSync(path.join(context.workspace, name));
    }
    return context;
  }

  function teardown(): void {
    try {
      fixture.teardown();
    } finally {
      for (const [key, value] of Object.entries(savedGitOverrides)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
  }

  return { setup, teardown };
}
