import { Check, Circle, CircleAlert, LoaderCircle } from "lucide-react";

const stages = [
  { id: "ingest", title: "Ingest", description: "Normalize PDFs and images into page sources." },
  { id: "extract", title: "Extract", description: "Recover text, notation, diagrams, and semantic reading order." },
  { id: "compile", title: "Compile", description: "Validate and assemble the accessible semantic document." },
] as const;

type StepState = "pending" | "active" | "complete" | "failed";

function activeIndex(processingStage: string) {
  if (processingStage === "ai_conversion") return 1;
  if (processingStage === "schema_validation" || processingStage === "complete") return 2;
  return 0;
}

export function PipelineList({ processingStage = "idle", failed = false }: { processingStage?: string; failed?: boolean }) {
  const current = activeIndex(processingStage);
  const finished = processingStage === "complete";

  function stateFor(index: number): StepState {
    if (finished || index < current) return "complete";
    if (failed && index === current) return "failed";
    if (processingStage !== "idle" && index === current) return "active";
    return "pending";
  }

  return (
    <ol className="pipeline-list">
      {stages.map((stage, index) => (
        <li key={stage.id} className={`pipeline-step pipeline-step-${stateFor(index)}`}>
          <span className="pipeline-icon" aria-label={`${stage.title}: ${stateFor(index)}`}>
            {stateFor(index) === "complete" ? <Check /> : stateFor(index) === "active" ? <LoaderCircle className="spin" /> : stateFor(index) === "failed" ? <CircleAlert /> : <Circle />}
          </span>
          <div><strong>{stage.title}</strong><p>{stage.description}</p></div>
        </li>
      ))}
    </ol>
  );
}
