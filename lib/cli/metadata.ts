import { extractMetadata } from "../pipeline/metadata/metadata.js";
import type { LLMProvider } from "../pipeline/metadata/metadata.js";
import { runWithProgress } from "./progress.js";

const args = process.argv.slice(2);
const providerIndex = args.indexOf("--provider");
let provider: LLMProvider | undefined;
if (providerIndex !== -1) {
  provider = args.splice(providerIndex, 2)[1] as LLMProvider;
  if (!["openai", "anthropic", "google"].includes(provider)) {
    console.error("Invalid provider. Choose: openai, anthropic, google");
    process.exit(1);
  }
}

const label = args[0];

if (!label) {
  console.error("Usage: metadata <label> [--provider openai|anthropic|google]");
  process.exit(1);
}

const PHASES = ["loading", "calling-llm", "done"] as const;

await runWithProgress(
  extractMetadata(label, { provider }),
  (p) => ({
    current: PHASES.indexOf(p.phase) + 1,
    total: PHASES.length,
  }),
  { label: "metadata", unit: "steps" }
);
