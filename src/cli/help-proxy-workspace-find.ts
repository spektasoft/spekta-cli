import type { HelpTopic } from "./help-topic";
import { listAllowanceHelp } from "./help-proxy-workspace-list";

function createWorkspaceFindHelp(): Record<string, HelpTopic> {
  return {
    find: {
      title: "find — Discover eligible workspace paths",
      purpose:
        "Search below multiple workspace roots with supported find predicates, then disclose only eligible paths.",
      usage: [
        "spekta find [--allowance <tokens>] [root...] [-type f|d] [-name pattern] [-print]",
        "spekta find [--allowance <tokens>] [-type f|d] [-name pattern] [-print]",
      ],
      sections: [
        {
          heading: "Operands and predicates",
          lines: [
            "Supply zero or more roots before the first predicate. No roots means .; each root is evaluated independently, in supplied order, and duplicate roots are preserved.",
            "Relative parent references and POSIX absolute roots are accepted as operands. A root is available only when its resolved canonical target remains inside the workspace and passes access and ignore policy; outside or otherwise unavailable roots receive the same concealed ordinal outcome.",
            "Roots beginning with a dash must use ./, such as ./-directory. Windows roots, glob/root notation, trailing slashes, repeated separators, and roots after predicates are unsupported.",
            "-type accepts one value: f for files or d for directories.",
            "-name accepts one nonempty literal argument. Quote shell globs so the pattern reaches Spekta unchanged; values such as --help, --allowance, and -exec remain pattern values, not options or actions.",
            "Use -type and -name together in either order. Each predicate may appear once.",
            "-print is optional and, when present, must be the final token. It prints matching paths.",
            "Find uses physical -P traversal: directory symlinks beneath a root are not followed. A contained directory symlink supplied as a root is handled physically, and descendants reached through directory symlinks are filtered.",
            "Only whole eligible paths are returned. Empty roots say 'No eligible paths in this discovery.' Partial batches identify unavailable or incomplete operands; narrow an incomplete root or request a larger allowance when the configured ceiling permits it.",
            "The minimum allowance is measured from the complete transport-specific validation response. A smaller allowance is rejected before RTK is probed; that validation response uses the configured default budget, not the rejected allowance.",
            "If the configured default cannot contain the mandatory validation diagnostic, Spekta emits a short recovery message even though that rejected-request response exceeds the default. Raise SPEKTA_LIST_TOKEN_LIMIT and, when the minimum exceeds the ceiling, SPEKTA_LIST_TOKEN_CEILING; shorten an unusually long MCP request ID if needed.",
            "This exception applies only to rejected validation requests. Accepted discovery responses always fit their requested allowance.",
            listAllowanceHelp(),
            "The complete formatted CLI response or MCP JSON-RPC envelope, including outcomes and transport metadata, is measured against one allowance for the whole request.",
            "RTK and the find backend must be available to run find. Help does not invoke either one.",
            "The CLI allowance must be the first argument after find. MCP uses the existing allowance field. Original shell find commands do not accept Spekta's allowance option.",
            "The supported backend requires Linux or WSL with GNU Findutils through RTK proxy find. Native Windows find.exe is unsupported.",
          ],
        },
      ],
      examples: [
        "spekta find",
        "spekta find --allowance 2000 src test -type f -name '*.ts'",
        "spekta find src test src -name '*.md'",
        "spekta find -name '*.md'",
        "spekta find . -type f -name '*.ts'",
        "spekta find src -type f -name '*.ts' -print",
        "spekta find 'folder with spaces' -type d",
      ],
      complete: true,
    },
  };
}

export const PROXY_WORKSPACE_FIND_HELP = createWorkspaceFindHelp();
