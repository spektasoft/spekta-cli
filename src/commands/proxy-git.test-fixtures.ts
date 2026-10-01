export const acceptedGitRequests: string[][] = [
  ["status"],
  ["status", "-s"],
  ["status", "--short"],
  ["status", "-b"],
  ["status", "--branch"],
  ["status", "--porcelain"],
  ["status", "--porcelain=v1"],
  ["status", "--porcelain=v2"],
  ["status", "--untracked-files=no"],
  ["status", "--untracked-files=normal"],
  ["status", "--untracked-files=all"],
  ["status", "--"],
  ["status", "--short", "--", "file.txt", "space name", "-file"],
  ["log"],
  ["log", "--oneline"],
  ["log", "--graph"],
  ["log", "--all"],
  ["log", "--decorate"],
  ["log", "--decorate=short"],
  ["log", "--decorate=full"],
  ["log", "--decorate=no"],
  ["log", "-n", "2"],
  ["log", "--max-count=2"],
  ["log", "-p"],
  ["log", "--patch"],
  ["log", "--no-patch"],
  ["log", "--stat"],
  ["log", "--name-only"],
  ["log", "--name-status"],
  ["log", "HEAD~2^0"],
  ["log", "feature/topic"],
  ["log", "refs/heads/main"],
  ["log", "a1b2c3d"],
  ["log", "main..HEAD"],
  ["log", "main...HEAD"],
  ["log", "..HEAD"],
  ["log", "HEAD.."],
  ["log", "HEAD", "feature/topic"],
  ["log", "--oneline", "HEAD", "--", "deleted.txt", "-file"],
  ["show"],
  ["show", "--oneline"],
  ["show", "-p"],
  ["show", "--patch"],
  ["show", "--no-patch"],
  ["show", "--stat"],
  ["show", "--name-only"],
  ["show", "--name-status"],
  ["show", "HEAD^"],
  ["show", "HEAD~0"],
  ["show", "HEAD", "--", "file.txt"],
  ["show", "--", "deleted.txt"],
  ["show", "HEAD:file.txt"],
  ["show", "--no-patch", "HEAD:space name"],
  ["show", "HEAD:-file"],
  ["show", "HEAD:deleted.txt", "--"],
];

export const rejectedGitRequests: Array<[string[], RegExp]> = [
  [[], /unsupported Git subcommand/i],
  [["diff"], /unsupported Git subcommand/i],
  [["help"], /unsupported Git subcommand/i],
  [["Status"], /unsupported Git subcommand/i],
  [["status", "file.txt"], /paths require/i],
  [["status", "-sb"], /unsupported option/i],
  [["status", "--porc"], /unsupported option/i],
  [["status", "--porcelain=v3"], /unsupported option/i],
  [["status", "--porcelain", "v1"], /paths require/i],
  [["status", "--untracked-files=maybe"], /unsupported option/i],
  [["log", "--output=output.txt"], /unsupported option/i],
  [["show", "--ext-diff"], /unsupported option/i],
  [["show", "--textconv"], /unsupported option/i],
  [["log", "--max-count"], /unsupported option/i],
  [["log", "-n"], /count option/i],
  [["log", "-n", "0"], /count option/i],
  [["log", "-n", "-1"], /count option/i],
  [["log", "-n", "1.5"], /count option/i],
  [["log", "-n", "9007199254740992"], /count option/i],
  [["log", "--max-count="], /count option/i],
  [["log", "-n", "1", "--max-count=2"], /count option/i],
  [["log", "-n1"], /unsupported option/i],
  [["show", "-n", "1"], /unsupported option/i],
  [["show", "HEAD", "main"], /at most one/i],
  [["show", "HEAD", "--stat"], /at most one/i],
  [["log", "HEAD", "--graph"], /unsupported option/i],
  [["log", ".."], /unsupported Git revision/i],
  [["log", "..."], /unsupported Git revision/i],
  [["log", "main....HEAD"], /unsupported Git revision/i],
  [["show", "main..HEAD"], /unsupported Git revision/i],
  [["show", "HEAD@{1}"], /unsupported Git revision/i],
  [["show", "HEAD^{commit}"], /unsupported Git revision/i],
  [["log", ":/message"], /unsupported Git revision/i],
  [["show", "HEAD~9007199254740992"], /unsupported Git revision/i],
  [["show", "../file"], /unsupported Git revision/i],
  [["show", "bad.lock"], /unsupported Git revision/i],
  [["show", "refs//heads/main"], /unsupported Git revision/i],
  [["show", "bad name"], /unsupported Git revision/i],
  [["show", ""], /unsupported Git revision/i],
  [["show", "bad\nname"], /unsupported Git revision/i],
  [["show", ":file.txt"], /unsupported Git revision/i],
  [["show", ":0:file.txt"], /unsupported Git revision/i],
  [["show", "HEAD:"], /invalid Git blob path/i],
  [["show", "HEAD:./file.txt"], /invalid Git blob path/i],
  [["show", "HEAD:../file.txt"], /invalid Git blob path/i],
  [["show", "HEAD:/tmp/file"], /blob path syntax/i],
  [["show", "HEAD:C:/outside"], /blob path syntax/i],
  [["show", "HEAD:*.ts"], /blob path syntax/i],
  [["show", "HEAD:file:part"], /blob path syntax/i],
  [["show", "HEAD:file.txt", "--", "other"], /additional path/i],
  [["status", "--", "--", "file.txt"], /multiple Git path separators/i],
  [["log", "--", ""], /invalid Git path/i],
  [["show", "--", "bad\0name"], /invalid Git path/i],
  [["show", "--", "bad\nname"], /invalid Git path/i],
  [["log", "--", ":(top)file"], /unsupported Git path/i],
  [["show", "--", "*.ts"], /unsupported Git path/i],
];
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
  ["--literal-pathspecs"],
  ["--bare"],
  ["--skip-env"],
  ["--ultra-compact"],
]) {
  for (const subcommand of ["status", "log", "show"]) {
    rejectedGitRequests.push([[...override, subcommand], /unsupported/i]);
    rejectedGitRequests.push([[subcommand, ...override], /unsupported/i]);
  }
}
for (const operand of [
  "../outside",
  "/tmp/outside",
  "C:/outside",
  String.raw`C:\outside`,
  String.raw`\\server\share`,
  "escape",
  "escape/missing/file",
]) {
  for (const subcommand of ["status", "log", "show"]) {
    rejectedGitRequests.push([
      [subcommand, "--", operand],
      /outside the project directory/i,
    ]);
  }
}
for (const operand of [
  ".env",
  ".gitignore",
  ".spektaignore",
  ".env/missing",
  "restricted-alias",
  "restricted-alias/missing/file",
]) {
  for (const subcommand of ["status", "log", "show"]) {
    rejectedGitRequests.push([[subcommand, "--", operand], /restricted/i]);
  }
  rejectedGitRequests.push([["show", `HEAD:${operand}`], /restricted/i]);
}
for (const subcommand of ["status", "log", "show"]) {
  rejectedGitRequests.push([[subcommand, "--unknown"], /unsupported option/i]);
  rejectedGitRequests.push([
    [subcommand, "--spekta-force"],
    /unsupported option/i,
  ]);
  rejectedGitRequests.push([
    [subcommand, "--", "--spekta-force=true"],
    /unsupported option/i,
  ]);
  rejectedGitRequests.push([
    [subcommand, "--", "dangling"],
    /ENOENT|no such file/i,
  ]);
  rejectedGitRequests.push([
    [subcommand, "--", "dangling/missing"],
    /ENOENT|no such file/i,
  ]);
}
rejectedGitRequests.push([
  ["show", "HEAD:escape/missing/file"],
  /outside the project directory/i,
]);
rejectedGitRequests.push([["show", "HEAD:dangling"], /ENOENT|no such file/i]);
