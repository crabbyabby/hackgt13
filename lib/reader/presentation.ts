import type { NoteBlock, SemanticNote } from "@/lib/domain/note";
import { associateEquationAnnotations } from "@/lib/reader/annotations";

export type ReaderItem =
  | { type: "heading"; text: string; sourceIndex: number }
  | { type: "prose"; text: string; sourceIndices: number[] }
  | { type: "math"; block: NoteBlock; label: "Formula" | "Equation" | "Example"; sourceIndex: number; annotations: string[] }
  | { type: "visual"; block: NoteBlock; sourceIndex: number };

function normalized(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, " ").replace(/\b2\b/g, "to").trim();
}

export function readableText(block: NoteBlock) {
  const preferred = [...(block.interpretations ?? [])]
    .sort((left, right) => right.confidence - left.confidence)
    .find((candidate) => candidate.reading.trim())?.reading;
  return (preferred ?? block.text)
    .split(/\n\s*\n/)
    .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join("\n\n");
}

function completeSentence(value: string) {
  let text = value.trim();
  if (!text) return "";
  const symbolMeaning = text.match(/^([A-Za-z])\s+for\s+(.+)$/i);
  if (symbolMeaning) text = `${symbolMeaning[1]} stands for ${symbolMeaning[2]}`;
  const capitalized = /^[a-z]/.test(text) ? `${text[0].toUpperCase()}${text.slice(1)}` : text;
  return /[.!?)]$/.test(capitalized) ? capitalized : `${capitalized}.`;
}

function mergeProse(parts: string[]) {
  const sentences: string[] = [];
  for (const part of parts) {
    if (/^(for|where|when|which|with|because|so that)\b/i.test(part) && sentences.length) {
      const previous = sentences.pop()!.replace(/[.!?]$/, "");
      sentences.push(completeSentence(`${previous} ${part.toLowerCase()}`));
    } else {
      sentences.push(completeSentence(part));
    }
  }
  return sentences.filter(Boolean).join(" ");
}

function isTailArtifact(text: string) {
  return /^notebook line markers\b/i.test(text) || /^[A-Z]{4,12}$/.test(text);
}

function isExampleHeading(text: string) {
  return /^(ex\.?|example)\s*\d+\b/i.test(text);
}

function isExplicitHeading(block: NoteBlock, text: string) {
  if (block.kind === "heading") return true;
  if (isExampleHeading(text)) return true;
  return text.split(/\s+/).length === 1 && text.length > 3 && block.kind !== "annotation";
}

function mathLabel(block: NoteBlock, exampleMode: boolean) {
  const context = `${block.title ?? ""} ${block.math?.label ?? ""} ${block.math?.spoken ?? ""}`;
  if (exampleMode || /^example\b/i.test(block.math?.spoken ?? "")) return "Example" as const;
  if (/\b(new formula|formula|definition)\b/i.test(context)) return "Formula" as const;
  return "Equation" as const;
}

export function buildReaderItems(note: SemanticNote): ReaderItem[] {
  const duplicateTitleIndex = note.blocks.findIndex(
    (block) => !block.math && normalized(readableText(block)) === normalized(note.title),
  );
  const startIndex = duplicateTitleIndex >= 0 ? duplicateTitleIndex + 1 : 0;
  const annotations = associateEquationAnnotations(note.blocks);
  const items: ReaderItem[] = [];
  let pendingText: string[] = [];
  let pendingIndices: number[] = [];
  let exampleMode = false;

  const flushProse = () => {
    const text = mergeProse(pendingText);
    if (text) items.push({ type: "prose", text, sourceIndices: pendingIndices });
    pendingText = [];
    pendingIndices = [];
  };

  note.blocks.forEach((block, sourceIndex) => {
    if (sourceIndex < startIndex) return;
    if (annotations.consumedIndices.has(sourceIndex)) return;
    const text = readableText(block);
    const nearDocumentEnd = sourceIndex >= note.blocks.length - 2;
    if (nearDocumentEnd && isTailArtifact(text)) return;

    if (block.math) {
      flushProse();
      const label = mathLabel(block, exampleMode);
      items.push({ type: "math", block, label, sourceIndex, annotations: annotations.byEquationId.get(block.id) ?? [] });
      if (label === "Example") exampleMode = true;
      return;
    }
    if (block.kind === "graph" || block.kind === "diagram") {
      flushProse();
      items.push({ type: "visual", block, sourceIndex });
      return;
    }
    if (isExplicitHeading(block, text)) {
      flushProse();
      exampleMode = isExampleHeading(text);
      const heading = /^ex\.?\s+\d/i.test(text)
        ? text.replace(/^ex\.?\s+/i, "Example ")
        : text;
      items.push({ type: "heading", text: completeSentence(heading).replace(/\.$/, ""), sourceIndex });
      return;
    }
    if (text) {
      const paragraphs = text.split(/\n\n+/).filter(Boolean);
      if (paragraphs.length > 1) {
        for (const paragraph of paragraphs) {
          pendingText.push(paragraph);
          pendingIndices.push(sourceIndex);
          flushProse();
        }
      } else {
        pendingText.push(text);
        pendingIndices.push(sourceIndex);
      }
    }
  });
  flushProse();
  return items;
}
