import { getLlmLog } from "@/lib/books";
import { LlmLogViewer } from "./llm-log-viewer";

export default async function LlmLogPage({
  params,
}: {
  params: Promise<{ label: string }>;
}) {
  const { label } = await params;
  const entries = getLlmLog(label);

  return (
    <div>
      {entries.length === 0 ? (
        <p className="text-faint">No log entries</p>
      ) : (
        <LlmLogViewer label={label} entries={entries} />
      )}
    </div>
  );
}
