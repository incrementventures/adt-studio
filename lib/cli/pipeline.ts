import { extract } from "../pipeline/extract/extract.js";
import { extractMetadata } from "../pipeline/metadata/metadata.js";
import { extractText } from "../pipeline/text-extraction/text-extraction.js";
import { sectionPages } from "../pipeline/page-sectioning/page-sectioning.js";
import type { LLMProvider } from "../pipeline/types.js";
import { runWithProgress } from "./progress.js";

const VALID_PROVIDERS = ["openai", "anthropic", "google"] as const;

const USAGE = `Usage: pnpm pipeline <command> [args] [options]

Commands:
  extract <pdf_path>                Extract pages from a PDF
  metadata <label>                  Extract metadata via LLM
  text-extraction <label>           Extract structured text via LLM
  page-sectioning <label>           Group text into sections via LLM

Options:
  --provider openai|anthropic|google   LLM provider (metadata, text-extraction, page-sectioning)`;

const args = process.argv.slice(2);
const subcommand = args[0];

if (!subcommand) {
  console.error(USAGE);
  process.exit(1);
}

// Parse --provider flag from remaining args
const rest = args.slice(1);
const providerIndex = rest.indexOf("--provider");
let provider: LLMProvider | undefined;
if (providerIndex !== -1) {
  provider = rest.splice(providerIndex, 2)[1] as LLMProvider;
  if (!VALID_PROVIDERS.includes(provider as (typeof VALID_PROVIDERS)[number])) {
    console.error("Invalid provider. Choose: openai, anthropic, google");
    process.exit(1);
  }
}

const positional = rest[0];

const METADATA_PHASES = ["loading", "calling-llm", "done"] as const;

switch (subcommand) {
  case "extract": {
    if (!positional) {
      console.error("Usage: pnpm pipeline extract <pdf_path>");
      process.exit(1);
    }
    await runWithProgress(
      extract(positional),
      (p) => ({ current: p.page, total: p.totalPages }),
      { label: "extract" }
    );
    break;
  }

  case "metadata": {
    if (!positional) {
      console.error(
        "Usage: pnpm pipeline metadata <label> [--provider openai|anthropic|google]"
      );
      process.exit(1);
    }
    await runWithProgress(
      extractMetadata(positional, { provider }),
      (p) => ({
        current: METADATA_PHASES.indexOf(p.phase) + 1,
        total: METADATA_PHASES.length,
      }),
      { label: "metadata", unit: "steps" }
    );
    break;
  }

  case "text-extraction": {
    if (!positional) {
      console.error(
        "Usage: pnpm pipeline text-extraction <label> [--provider openai|anthropic|google]"
      );
      process.exit(1);
    }
    await runWithProgress(
      extractText(positional, { provider }),
      (p) => ({
        current: p.page ?? 0,
        total: p.totalPages ?? 0,
      }),
      { label: "text-extraction", unit: "pages" }
    );
    break;
  }

  case "page-sectioning": {
    if (!positional) {
      console.error(
        "Usage: pnpm pipeline page-sectioning <label> [--provider openai|anthropic|google]"
      );
      process.exit(1);
    }
    await runWithProgress(
      sectionPages(positional, { provider }),
      (p) => ({
        current: p.page ?? 0,
        total: p.totalPages ?? 0,
      }),
      { label: "page-sectioning", unit: "pages" }
    );
    break;
  }

  default:
    console.error(`Unknown command: ${subcommand}\n`);
    console.error(USAGE);
    process.exit(1);
}
