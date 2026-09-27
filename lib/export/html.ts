import type { NoteBlock, SemanticNote } from "@/lib/domain/note";
import { associateEquationAnnotations } from "@/lib/reader/annotations";

const escape = (value: string) => value.replace(/[&<>"']/g, (character) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] as string));

type CompiledMath = { latex: string; mathml: string | null; mathmlError: string | null; structureWarning: string | null; needsReview: boolean };

function formula(math: NonNullable<NoteBlock["math"]>) {
  return math.mathml && math.mathml.trim().startsWith("<math")
    ? `<figure>${math.mathml}<figcaption class="sr-only">${escape(math.spoken)}</figcaption></figure>`
    : `<p><code>${escape(math.latex)}</code> <em>(unverified notation: ${escape(math.spoken)})</em></p>`;
}

function relationSymbol(block: NoteBlock) {
  const value = (block.math?.latex || block.text || "").trim();
  if (/^(?:~|\\sim|∼)$/.test(value)) return "∼";
  if (/^(?:≈|\\approx)$/.test(value)) return "≈";
  if (/^(?:≃|\\simeq)$/.test(value)) return "≃";
  if (/^(?:=|\\equiv)$/.test(value)) return "≡";
  return null;
}

function sameEquationLine(left: NoteBlock, relation: NoteBlock, right: NoteBlock) {
  const positions = [left, relation, right].map((block) => block.sourceRegion);
  if (positions.some((position) => !position)) return true;
  const [a, b, c] = positions as NonNullable<NoteBlock["sourceRegion"]>[];
  const centers = [a.y + a.height / 2, b.y + b.height / 2, c.y + c.height / 2];
  const xCenters = [a.x + a.width / 2, b.x + b.width / 2, c.x + c.width / 2];
  return Math.max(...centers) - Math.min(...centers) <= 3 && xCenters[0] < xCenters[1] && xCenters[1] < xCenters[2];
}

function annotationHtml(annotations: string[]) {
  return annotations.map((annotation) =>
    `<p class="equation-annotation"><strong>Handwritten annotation:</strong> ${escape(annotation)}</p>`
  ).join("");
}

async function pageImage(documentId: string, page: number) {
  const response = await fetch(`/api/documents/${encodeURIComponent(documentId)}/pages/${page}`);
  if (!response.ok) throw new Error(`Could not load original page ${page}.`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return `data:${response.headers.get("Content-Type") ?? "image/png"};base64,${btoa(binary)}`;
}

export async function downloadStandaloneHtml(
  note: SemanticNote,
  { includeOriginalPages = true }: { includeOriginalPages?: boolean } = {},
) {
  const pageCount = Math.max(1, note.source.pageCount);
  const compiledMath = new Map<string, CompiledMath>();
  await Promise.all(note.blocks.filter((block) => block.math).map(async (block) => {
    try {
      const response = await fetch("/api/mathml", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ latex: block.math!.latex }),
      });
      if (response.ok) compiledMath.set(block.id, await response.json() as CompiledMath);
    } catch {
      // The extraction-time MathML remains a usable fallback if the compiler is offline.
    }
  }));
  const images = includeOriginalPages && note.source.documentId
    ? await Promise.all(Array.from({ length: pageCount }, (_, index) => pageImage(note.source.documentId!, index + 1)))
    : [];
  const pageHtml = Array.from({ length: pageCount }, (_, pageIndex) => {
    const page = pageIndex + 1;
    const blocks = note.blocks.filter((block) => (block.page ?? 1) === page);
    const associatedAnnotations = associateEquationAnnotations(blocks);
    const alt = blocks.map((block) => block.text || block.title || block.altText || "")
      .filter(Boolean).join(" ").replace(/\s+/g, " ").slice(0, 360) || `Handwritten notes, page ${page}`;
    const image = images[pageIndex]
      ? `<figure class="source-page"><img src="${images[pageIndex]}" alt="Page ${page}: ${escape(alt)}"><figcaption><strong>Original handwritten page ${page}</strong></figcaption></figure>`
      : "";
    const contentItems: string[] = [];
    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      if (associatedAnnotations.consumedIndices.has(index)) continue;
      const relation = blocks[index + 1];
      const right = blocks[index + 2];
      const relationLatex = relation && relationSymbol(relation);
      if (block.math && relation && relationLatex && right?.math && sameEquationLine(block, relation, right)) {
        const leftCompiled = compiledMath.get(block.id);
        const rightCompiled = compiledMath.get(right.id);
        const leftMath = leftCompiled ? {
          ...block.math, latex: leftCompiled.latex, mathml: leftCompiled.mathml ?? block.math.mathml,
          mathmlError: leftCompiled.mathmlError ?? block.math.mathmlError,
          structureWarning: leftCompiled.structureWarning ?? block.math.structureWarning,
        } : block.math;
        const rightMath = rightCompiled ? {
          ...right.math, latex: rightCompiled.latex, mathml: rightCompiled.mathml ?? right.math.mathml,
          mathmlError: rightCompiled.mathmlError ?? right.math.mathmlError,
          structureWarning: rightCompiled.structureWarning ?? right.math.structureWarning,
        } : right.math;
        const spokenRelation = relationLatex === "∼" ? "is equivalent to" : relationLatex === "≈" ? "is approximately equal to" : relationLatex === "≃" ? "is similar to" : "is equivalent to";
        const pairAnnotations = [
          ...(associatedAnnotations.byEquationId.get(block.id) ?? []),
          ...(associatedAnnotations.byEquationId.get(right.id) ?? []),
        ];
        contentItems.push(`<section class="content-block"><div class="equation"><div class="equation-line" role="group" aria-label="${escape(`${block.math.spoken} ${spokenRelation} ${right.math.spoken}`)}">${formula(leftMath)}<span class="relation-operator" aria-hidden="true">${relationLatex}</span>${formula(rightMath)}</div>${annotationHtml(pairAnnotations)}</div></section>`);
        index += 2;
        continue;
      }
      const compiled = compiledMath.get(block.id);
      const displayMath = block.math && compiled
        ? { ...block.math, latex: compiled.latex, mathml: compiled.mathml ?? block.math.mathml,
          mathmlError: compiled.mathmlError ?? block.math.mathmlError,
          structureWarning: compiled.structureWarning ?? block.math.structureWarning }
        : block.math;
      const context = displayMath && block.text && block.text !== block.math?.spoken
        ? `<p>${escape(block.text)}</p>` : (!displayMath && block.text ? `<p>${escape(block.text)}</p>` : "");
      const heading = block.kind === "heading" ? `<h4>${escape(block.title ?? block.text)}</h4>` : "";
      const equation = displayMath ? `<div class="equation">${formula(displayMath)}</div>` : "";
      const visual = block.altText ? `<figure><figcaption>Visual description</figcaption><p>${escape(block.altText)}</p></figure>` : "";
      contentItems.push(`<section class="content-block">${heading}${context}${equation}${annotationHtml(associatedAnnotations.byEquationId.get(block.id) ?? [])}${visual}</section>`);
    }
    const content = contentItems.join("\n");
    return `<section class="page"><h3>Page ${page}</h3>${image}<div class="page-content">${content}</div></section>${page < pageCount ? '<hr class="page-break">' : ""}`;
  }).join("\n");
  const styles = `:root{color-scheme:light}body{max-width:960px;margin:0 auto;padding:2rem 1.5rem;color:#172b3d;font:18px/1.65 system-ui,-apple-system,"Segoe UI",sans-serif}h1{font-size:2.25rem;line-height:1.2}h3{margin:0 0 1rem;color:#245a80;font-size:1.55rem}.source-page{margin:1rem 0 2rem}.source-page img{display:block;max-width:100%;height:auto;margin:auto;border:1px solid #ccd8e1}.source-page figcaption{margin-top:.5rem;text-align:center;color:#526474}.page-content{display:grid;gap:1rem}.content-block{min-width:0}.content-block p{margin:.3rem 0}.content-block h4{margin:.6rem 0;font-size:1.25rem}.equation{overflow-x:auto;text-align:center;padding:1rem 0}.equation math{display:block;font-size:1.2em;overflow-x:auto}.equation-line{display:flex;align-items:center;justify-content:center;gap:1.1rem;min-width:max-content}.equation-line figure{margin:0}.equation-line math{display:block}.relation-operator{font-size:1.5em}.equation-annotation{max-width:70rem;margin:.2rem auto 0;color:#5e6e7d;font-size:.78rem;line-height:1.45;text-align:left}.page-break{margin:40px 0;border:0;border-top:2px solid #3498db}.source-unavailable{padding:1rem;background:#f4f7f9}@media print{body{max-width:none;padding:0}.page{break-inside:avoid}.page-break{break-after:page}}.sr-only{position:absolute;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}`;
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escape(note.title)}</title><style>${styles}</style></head><body><main><header><h1>${escape(note.title)}</h1><p>Accessible transcription of ${escape(note.source.name)}.</p></header>${pageHtml}</main></body></html>`;
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${note.slug}.html`;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
