import { resolveHash } from "../git";
import { promptCommitHash } from "../ui";

export async function runCommitRange() {
  try {
    const args = process.argv.slice(3); // Skip 'node', 'script', 'commit-range'

    let hash1: string;
    let hash2: string;

    // Check if hashes provided as CLI arguments
    if (args.length >= 2) {
      hash1 = args[0];
      hash2 = args[1];
      console.log(`Using provided hashes: ${hash1}..${hash2}`);
    } else {
      // Interactive prompts
      hash1 = await promptCommitHash(
        "Enter first commit hash (older):",
        (value) => {
          if (!value || value.trim().length === 0) {
            return "Commit hash is required";
          }
          return true;
        },
      );

      hash2 = await promptCommitHash(
        "Enter second commit hash (newer):",
        (value) => {
          if (!value || value.trim().length === 0) {
            return "Commit hash is required";
          }
          return true;
        },
      );
    }

    // Resolve hashes to full commit references
    const resolvedHash1 = await resolveHash(hash1.trim());
    const resolvedHash2 = await resolveHash(hash2.trim());

    console.log(
      `\nResolved range: ${resolvedHash1.substring(0, 7)}..${resolvedHash2.substring(0, 7)}`,
    );

    // Placeholder
    console.log("Fetching commit messages...");
  } catch (error: any) {
    console.error(`Error: ${error.message}`);
    process.exitCode = 1;
  }
}
