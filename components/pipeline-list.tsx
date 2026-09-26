import { Check, CircleDashed } from "lucide-react";
import type { PipelineStage } from "@/lib/domain/note";

const stages: Array<{ id: PipelineStage; title: string; description: string }> = [
  { id: "ingest", title: "Ingest", description: "Normalize PDFs and images into page sources." },
  { id: "layout", title: "Layout", description: "Recover regions, reading order, color, and emphasis." },
  { id: "math", title: "Math", description: "Parse notation into LaTeX, spoken math, and symbols." },
  { id: "visuals", title: "Visuals", description: "Identify graphs and diagrams and draft descriptions." },
  { id: "reconcile", title: "Reconcile", description: "Resolve ambiguity using surrounding context." },
  { id: "accessibility", title: "Compile", description: "Create the semantic note used by every output." },
];

export function PipelineList({ running = false }: { running?: boolean }) {
  return (
    <ol className="pipeline-list">
      {stages.map((stage, index) => (
        <li key={stage.id}>
          <span className="pipeline-icon">{running && index === 0 ? <CircleDashed className="spin" /> : <Check />}</span>
          <div><strong>{stage.title}</strong><p>{stage.description}</p></div>
        </li>
      ))}
    </ol>
  );
}
