import type { NoteBlock } from "@/lib/domain/note";

const visualAnnotationCue = /\b(?:hand[- ]drawn|handwritten|circles?|arrows?|highlights?|underlined|crossed out|margin note|blue|red|green|ink marks?)\b/i;

function annotationDescription(block: NoteBlock) {
  const text = (block.altText || block.text).replace(/\s+/g, " ").trim();
  if (block.kind === "annotation") return text;
  if (block.kind === "paragraph" && /^\[[^\]]+\]$/.test(text) && visualAnnotationCue.test(text)) {
    return text.slice(1, -1).trim();
  }
  return "";
}

function intervalGap(startA: number, sizeA: number, startB: number, sizeB: number) {
  return Math.max(0, startA - (startB + sizeB), startB - (startA + sizeA));
}

/** Attach small visual-mark descriptions to the nearest equation on the same page. */
export function associateEquationAnnotations(blocks: NoteBlock[]) {
  const byEquationId = new Map<string, string[]>();
  const consumedIndices = new Set<number>();

  blocks.forEach((annotation, annotationIndex) => {
    const description = annotationDescription(annotation);
    const region = annotation.sourceRegion;
    if (!description || !region) return;

    const closest = blocks.flatMap((equation) => {
      if (!equation.math || equation.sourceRegion?.page !== region.page) return [];
      const target = equation.sourceRegion;
      if (!target) return [];
      const verticalGap = intervalGap(region.y, region.height, target.y, target.height);
      if (verticalGap > 2.5) return [];
      const horizontalGap = intervalGap(region.x, region.width, target.x, target.width);
      return [{ id: equation.id, score: verticalGap * 10 + horizontalGap }];
    }).sort((left, right) => left.score - right.score)[0];

    if (closest) {
      byEquationId.set(closest.id, [...(byEquationId.get(closest.id) ?? []), description]);
      consumedIndices.add(annotationIndex);
    }
  });

  return { byEquationId, consumedIndices };
}
