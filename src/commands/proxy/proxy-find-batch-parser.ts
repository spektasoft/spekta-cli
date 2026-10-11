export interface FindPredicates {
  type?: "f" | "d";
  name?: string;
  print: boolean;
  args: string[];
}

export interface ParsedFindBatch {
  roots: string[];
  predicates: FindPredicates;
}

const hasUnsupportedRootCharacter = (root: string) =>
  ["\\", ":", "*", "?", "[", "]"].some((char) => root.includes(char));
const FORBIDDEN = (value: string): boolean =>
  value === "--spekta-force" || value.startsWith("--spekta-force=");

function invalid(reason: string): never {
  throw new Error(`usage_error: ${reason}`);
}

/** Parse the deliberately small find grammar without touching the filesystem. */
export function parseFindBatch(args: readonly string[]): ParsedFindBatch {
  if (
    args.some((arg) =>
      Array.from(arg).some(
        (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
      ),
    )
  )
    invalid("invalid find argument.");
  if (args.some(FORBIDDEN)) invalid("unsupported option '--spekta-force'.");

  const roots: string[] = [];
  let index = 0;
  while (index < args.length && !args[index].startsWith("-")) {
    const root = args[index];
    const absolutePosix = root.startsWith("/");
    if (
      root === "" ||
      root.startsWith("~/") ||
      hasUnsupportedRootCharacter(root) ||
      ["!", ","].includes(root) ||
      root === "(" ||
      root === ")" ||
      (absolutePosix && root.startsWith("//")) ||
      (root !== "/" && root.endsWith("/")) ||
      root.includes("//") ||
      root
        .split("/")
        .some(
          (part, partIndex) =>
            part === "." &&
            root !== "." &&
            !(partIndex === 0 && root.startsWith("./")),
        )
    )
      invalid("unsupported find token; unsupported find root syntax.");
    roots.push(root);
    index++;
  }

  let type: "f" | "d" | undefined;
  let name: string | undefined;
  let print = false;
  const predicateStart = index;
  while (index < args.length) {
    const token = args[index];
    if (!token.startsWith("-")) invalid("find roots must precede predicates.");
    if (token === "-type") {
      if (type !== undefined) invalid("duplicate find -type predicate.");
      const value = args[index + 1];
      if (value !== "f" && value !== "d")
        invalid("find -type requires exactly 'f' or 'd'.");
      type = value;
      index += 2;
    } else if (token === "-name") {
      if (name !== undefined) invalid("duplicate find -name predicate.");
      const value = args[index + 1];
      if (value === undefined || value === "")
        invalid("find -name requires a nonempty pattern.");
      // Consume the next token literally, including option-looking / shell-like strings.
      name = value;
      index += 2;
    } else if (token === "-print") {
      if (print || index !== args.length - 1)
        invalid(
          "unsupported find token: only one terminal -print action is supported.",
        );
      print = true;
      index++;
    } else {
      invalid("unsupported find token, expression, or action.");
    }
  }
  const selectedRoots = roots.length ? roots : ["."];
  return {
    roots: selectedRoots,
    predicates: {
      ...(type ? { type } : {}),
      ...(name !== undefined ? { name } : {}),
      print,
      // Keep the backend predicate sequence byte-for-byte in supplied order.
      args: args.slice(predicateStart),
    },
  };
}
