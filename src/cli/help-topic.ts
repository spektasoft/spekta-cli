/** Content contract shared by native and proxy help topics. */
export interface HelpTopic {
  title: string;
  purpose: string;
  usage: string[];
  sections?: { heading: string; lines: string[] }[];
  examples?: string[];
  complete: boolean;
}

export function renderTopic(topic: HelpTopic): string {
  const blocks = [
    `${topic.title}\n${topic.purpose}`,
    `Usage: ${topic.usage.join("\n       ")}`,
    ...(topic.sections ?? []).map(
      (section) => `${section.heading}:\n${section.lines.join("\n")}`,
    ),
    ...(topic.examples?.length
      ? [`Examples:\n${topic.examples.map((line) => `  ${line}`).join("\n")}`]
      : []),
    ...(topic.complete
      ? []
      : [
          "This topic is an overview; detailed command help is not yet complete.",
        ]),
  ];
  return `${blocks.join("\n\n")}\n`;
}
