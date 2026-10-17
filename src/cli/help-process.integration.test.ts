import { afterAll, beforeAll } from "vitest";
import { createHelpProcessHarness } from "./help-process-harness";
import { registerHelpProcessRoutingTests } from "./help-process-routing";
import { registerHelpProcessTopicResolutionTests } from "./help-process-topic-resolution";
import { registerHelpProcessSyntaxTests } from "./help-process-syntax";
import { registerHelpProcessSafetyTests } from "./help-process-safety";
import { registerHelpProcessCommandDetailsTests } from "./help-process-command-details";
import { registerHelpProcessRootTests } from "./help-process-root";

const harness = createHelpProcessHarness();
beforeAll(() => harness.build(), 30000);
afterAll(() => harness.cleanup());

registerHelpProcessRoutingTests(harness);
registerHelpProcessTopicResolutionTests(harness);
registerHelpProcessSyntaxTests(harness);
registerHelpProcessSafetyTests(harness);
registerHelpProcessCommandDetailsTests(harness);
registerHelpProcessRootTests(harness);
