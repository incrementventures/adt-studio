import { extractText } from "../pipeline/text-extraction/text-extraction.js";
import type { LLMProvider } from "../pipeline/types.js";
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
  console.error(
    "Usage: text-extraction <label> [--provider openai|anthropic|google]"
  );
  process.exit(1);
}

await runWithProgress(
  extractText(label, { provider }),
  (p) => ({
    current: p.page ?? 0,
    total: p.totalPages ?? 0,
  }),
  { label: "text-extraction", unit: "pages" }
);
