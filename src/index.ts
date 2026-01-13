import { bootstrap } from "./config";
import { runReview } from "./commands/review";
import { select } from "@inquirer/prompts";

async function main() {
  bootstrap();

  const args = process.argv.slice(2);
  const command = args[0];

  if (command === "review") {
    await runReview();
    return;
  }

  const action = await select({
    message: "What would you like to do?",
    choices: [
      { name: "Run Git Review", value: "review" },
      { name: "Exit", value: "exit" },
    ],
  });

  if (action === "review") await runReview();
  else if (action === "commit")
    console.log("Commit Message Generator: Coming Soon");
}

main().catch((err) => {
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
