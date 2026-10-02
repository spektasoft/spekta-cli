export { acceptedBranchRequests } from "./proxy-branch-accepted.test-fixtures";
import { unsupportedBranchForms } from "./proxy-branch-unsupported.test-fixtures";

export const rejectedBranchRequests: Array<[string[], RegExp]> = [
  [["branch", "new-branch"], /patterns require explicit listing/i],
  [["branch", "feature/topic"], /patterns require explicit listing/i],
  [["branch", "new-branch", "HEAD"], /patterns require explicit listing/i],
  [["branch", "--all", "feature/*"], /patterns require explicit listing/i],
  [["branch", "--remotes", "origin/*"], /patterns require explicit listing/i],
  [["branch", "--verbose", "new-branch"], /patterns require explicit listing/i],
  [["branch", "--"], /separator requires explicit listing/i],
  [["branch", "--", "new-branch"], /separator requires explicit listing/i],
  [
    ["branch", "--all", "--", "feature/*"],
    /separator requires explicit listing/i,
  ],
  [["branch", "--list", "--", "--"], /multiple Git branch separators/i],
  [["branch", "--list", "main", "--"], /unsupported option/i],
  [["branch", "--list", "main", "--", "--"], /multiple Git branch separators/i],
  [["branch", "--list", "main", "--all"], /unsupported option/i],
  [["branch", "--list", "--", "--all"], /unsupported option/i],
  ...[
    "",
    "bad\0name",
    "bad\nname",
    "bad\rname",
    "bad\tname",
    "bad\u001bname",
    "bad\u007fname",
  ].flatMap((pattern) => [
    [["branch", "--list", pattern], /invalid Git branch pattern/i] as [
      string[],
      RegExp,
    ],
    [["branch", "--list", "--", pattern], /invalid Git branch pattern/i] as [
      string[],
      RegExp,
    ],
  ]),
];


for (const form of unsupportedBranchForms) {
  for (const args of [
    ["branch", ...form],
    ["branch", "--list", ...form],
    ["branch", ...form, "--list"],
    ["branch", "--list", "main", ...form],
    ["branch", "--list", "--", ...form],
  ]) {
    rejectedBranchRequests.push([args, /unsupported option/i]);
  }
}
for (const override of [
  ["-c", "core.pager=sentinel"],
  ["-ccore.pager=sentinel"],
  ["--config-env", "core.pager=PAGER"],
  ["--config-env=core.pager=PAGER"],
  ["-C", "directory"],
  ["-Cdirectory"],
  ["--git-dir", ".git"],
  ["--git-dir=.git"],
  ["--work-tree", "."],
  ["--work-tree=."],
  ["--paginate"],
  ["--no-pager"],
  ["--bare"],
]) {
  rejectedBranchRequests.push([
    [...override, "branch"],
    /unsupported Git subcommand/i,
  ]);
}
