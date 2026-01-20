export const generateOverview = (content: string): string => {
  const lines = content.split("\n");
  const result: string[] = [];
  let inBlock = false;
  let blockStart = 0;

  // Pattern for top-level declarations
  const declPattern =
    /^(export\s+)?(class|interface|function|const|let|enum|type|async\s+function)\s+([a-zA-Z0-9_]+)/;
  // Pattern for imports
  const importPattern = /^import\s+/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isDecl = declPattern.test(line);
    const isImport = importPattern.test(line);

    if (isDecl || isImport || i < 5) {
      // Always show first 5 lines
      if (inBlock) {
        result.push(`// lines ${blockStart + 1}-${i}`);
        inBlock = false;
      }
      // If it's a declaration block, we show the signature and stub the rest
      if (isDecl && line.includes("{")) {
        result.push(line.split("{")[0].trim() + " { ... };");
      } else {
        result.push(line);
      }
    } else {
      if (!inBlock) {
        blockStart = i;
        inBlock = true;
      }
    }
  }

  if (inBlock) {
    result.push(`// lines ${blockStart + 1}-${lines.length}`);
  }

  return result.join("\n");
};
