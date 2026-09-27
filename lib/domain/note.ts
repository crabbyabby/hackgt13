export type SourceKind = "pdf" | "image";
export type BlockKind = "heading" | "paragraph" | "equation" | "graph" | "diagram" | "annotation";

export type MathExpressionNode = {
  latex: string;
  spoken?: string;
  mathml?: string;
  numerator?: MathExpressionNode;
  denominator?: MathExpressionNode;
  radicand?: MathExpressionNode;
  rootIndex?: MathExpressionNode;
  base?: MathExpressionNode;
  exponent?: MathExpressionNode;
  matrixRows?: MathExpressionNode[][];
  matrixColumns?: MathExpressionNode[][];
  alignedSteps?: MathExpressionNode[];
};

export type MathNode = {
  latex: string;
  spoken: string;
  label: string;
  variables: Array<{ symbol: string; meaning: string }>;
  /** Accessible notation. Absent when `latex` failed to compile server-side. */
  mathml?: string;
  mathmlError?: string;
  /** Set when the notation compiles but describes the wrong structure. */
  structureWarning?: string;
  tree?: MathExpressionNode;
};

export type NoteBlock = {
  id: string;
  kind: BlockKind;
  page?: number;
  title?: string;
  text: string;
  math?: MathNode;
  altText?: string;
  /** Optional ready-made crop, used by bundled samples and exported notes. */
  imageUrl?: string;
  /** Optional full-page image used to preview an editable crop in the browser. */
  sourceImageUrl?: string;
  sourceRegion?: { page: number; x: number; y: number; width: number; height: number };
  confidence: number;
  needsReview: boolean;
  reviewReason?: string;
  interpretations?: Array<{ reading: string; latex?: string; confidence: number; evidence: string }>;
};

export type SemanticNote = {
  id: string;
  slug: string;
  title: string;
  course?: string;
  source: { name: string; kind: SourceKind; pageCount: number; aiProvider?: string; aiModel?: string; documentId?: string; revision?: number };
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
