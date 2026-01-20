export const generateOverview = (content: string): string => {
  const lines = content.split("\n");
  const result: string[] = [];
  let inBlock = false;
  let blockStart = 0;

  // Generalized pattern for declarations across TS, Go, Rust, Python, Ruby, C#, Java, etc.
  // Supports: export, pub, private, async, static, public, protected, internal, final, etc.
  const declPattern =
    /^(export\s+|pub\s+|private\s+|protected\s+|public\s+|internal\s+|static\s+|final\s+|async\s+)?(class|interface|function|const|let|var|enum|type|def|func|fn|struct|trait|module|package|impl|alias|protocol|extension|record|namespace|service|controller|model|view|component)\s+([a-zA-Z0-9_]+)/;

  // Patterns for various import/include styles across languages
  const importPattern =
    /^(import|from|require|use|include|extern|mod|crate|package|using|add|import\s+type|import\s+as|import)\s+/;

  // Comment style detection
  const singleLineCommentPattern = /^(\s*\/\/|\s*#|\s*--|\s*\/\*|\s*\*\/)/;
  const blockCommentStartPattern = /^(\s*\/\*|\s*\/\*!)/;
  const blockCommentEndPattern = /\*\/\s*$/;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();
    const isDecl = declPattern.test(trimmed);
    const isImport = importPattern.test(trimmed);
    const isSingleLineComment = singleLineCommentPattern.test(trimmed);
    const isBlockCommentStart = blockCommentStartPattern.test(trimmed);
    const isBlockCommentEnd = blockCommentEndPattern.test(trimmed);

    // Show first 5 lines (headers/shebangs), declarations, imports, and comments
    if (
      isDecl ||
      isImport ||
      isSingleLineComment ||
      isBlockCommentStart ||
      i < 5
    ) {
      if (inBlock) {
        // Use language-agnostic line markers
        result.push(`... // lines ${blockStart + 1}-${i}`);
        inBlock = false;
      }

      // Stub brackets for C-style languages, otherwise just show the line
      if (isDecl && (line.includes("{") || line.includes(":"))) {
        const stubbed = line.includes("{")
          ? line.split("{")[0].trim() + " { ... }"
          : line.split(":")[0].trim() + ": ...";
        result.push(stubbed);
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
