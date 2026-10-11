import { rejectedGitRequests } from "./proxy-git.test-fixtures";
import { proxySecret as secret } from "./proxy-rejection.integration-helper";

export function rejectedPolicyRequests(): Array<[string, string[], RegExp]> {
  const requests: Array<[string, string[], RegExp]> = [
    ["unknown-command", [], /unsupported command/i],
    [secret, [], /unsupported command/i],
    ["/bin/ls", [], /unsupported command/i],
    ["ls; touch marker", [], /unsupported command/i],
    ["git", ["reset"], /unsupported Git subcommand/i],
    ["vitest", [], /unsupported command/i],
    ["jest", [], /unsupported command/i],
    ["pytest", [], /unsupported command/i],
    ["tsc", [], /unsupported command/i],
    ["cargo", ["build"], /unsupported command/i],
    ["npm", ["run", "build"], /unsupported command/i],
    ["pnpm", ["test"], /unsupported command/i],
    ["yarn", ["lint"], /unsupported command/i],
    ["bun", ["run", "script"], /unsupported command/i],
    ["node", ["script.js"], /unsupported command/i],
    ["sh", ["-c", "touch marker"], /unsupported command/i],
    ["ls", ["-a"], /unsupported option/i],
    ["ls", ["--"], /unsupported option/i],
    ["ls", ["--color=always"], /unsupported option/i],
    ["ls", ["--spekta-force"], /unsupported option.*--spekta-force/i],
    [
      "ls",
      ["directory", "--spekta-force"],
      /unsupported option.*--spekta-force/i,
    ],
    [
      "ls",
      ["--spekta-force", "directory"],
      /unsupported option.*--spekta-force/i,
    ],
    ["ls", ["--spekta-force=true"], /unsupported option.*--spekta-force/i],
    [
      "npm",
      ["run", "build", "--spekta-force"],
      /unsupported option.*--spekta-force/i,
    ],
    ["ls", [""], /invalid directory operand/i],
    ["ls", ["line\nbreak"], /invalid directory operand/i],
    ["ls", ["nul\0byte"], /invalid directory operand/i],
  ];
  requests.push(
    ...rejectedGitRequests.map(([args, reason]): [string, string[], RegExp] => [
      "git",
      args,
      reason,
    ]),
  );
  return requests;
}
