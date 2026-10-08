export const acceptedFindRequests: Array<{
  args: string[];
  expectedArgs: string[];
}> = [
  {
    args: [],
    expectedArgs: ["proxy", "find", "-P", "."],
  },
  {
    args: ["."],
    expectedArgs: ["proxy", "find", "-P", "."],
  },
  {
    args: ["-type", "f", "-name", "*.ts"],
    expectedArgs: ["proxy", "find", "-P", ".", "-type", "f", "-name", "*.ts"],
  },
  {
    args: [".", "-type", "f", "-name", "*.ts"],
    expectedArgs: ["proxy", "find", "-P", ".", "-type", "f", "-name", "*.ts"],
  },
  {
    args: [".", "-name", "*.ts", "-type", "f"],
    expectedArgs: ["proxy", "find", "-P", ".", "-name", "*.ts", "-type", "f"],
  },
  {
    args: ["directory", "-type", "d", "-print"],
    expectedArgs: ["proxy", "find", "-P", "directory", "-type", "d", "-print"],
  },
  {
    args: ["space name", "-name", "file name.ts", "-print"],
    expectedArgs: [
      "proxy",
      "find",
      "-P",
      "space name",
      "-name",
      "file name.ts",
      "-print",
    ],
  },
  {
    args: ["./-directory", "-name", "-exec"],
    expectedArgs: ["proxy", "find", "-P", "./-directory", "-name", "-exec"],
  },
  {
    args: [".", "-name", "../outside/*.ts"],
    expectedArgs: ["proxy", "find", "-P", ".", "-name", "../outside/*.ts"],
  },
  {
    args: [".", "-name", ".env"],
    expectedArgs: ["proxy", "find", "-P", ".", "-name", ".env"],
  },
];
