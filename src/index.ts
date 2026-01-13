import { bootstrap } from "./config";
import { runReview } from "./commands/review";
import { runCommit } from "./commands/commit";
import { select } from "@inquirer/prompts";

async function main() {
  await bootstrap();

  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "review") {
    await runReview();
    return;
  }

  if (command === "commit") {
    await runCommit();
    return;
  }

  const action = await select({
    message: "What would you like to do?",
    choices: [
      { name: "Run Git Review", value: "review" },
      { name: "Generate Commit Message", value: "commit" },
      { name: "Exit", value: "exit" },
    ],
  });

  if (action === "review") await runReview();
  else if (action === "commit") await runCommit();
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
