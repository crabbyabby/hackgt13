export type SourceKind = "pdf" | "image";
export type BlockKind = "heading" | "paragraph" | "equation" | "graph" | "diagram" | "annotation";

export type MathNode = {
  latex: string;
  spoken: string;
  label: string;
  variables: Array<{ symbol: string; meaning: string }>;
};

export type NoteBlock = {
  id: string;
  kind: BlockKind;
  title?: string;
  text: string;
  math?: MathNode;
  altText?: string;
  sourceRegion?: { page: number; x: number; y: number; width: number; height: number };
  confidence: number;
  needsReview: boolean;
};

export type SemanticNote = {
  id: string;
  slug: string;
  title: string;
  course?: string;
  source: { name: string; kind: SourceKind; pageCount: number };
  blocks: NoteBlock[];
  status: "draft" | "published";
  createdAt: string;
  updatedAt: string;
};

export type PipelineStage =
  | "ingest"
  | "layout"
  | "math"
  | "visuals"
  | "reconcile"
  | "accessibility";

export type ExtractionResult = {
  note: SemanticNote;
  provider: "openai" | "development";
  stages: Array<{ stage: PipelineStage; summary: string }>;
};
