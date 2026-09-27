import type { NoteBlock, SemanticNote } from "@/lib/domain/note";

const unicodeSubscripts: Record<string, string> = {
  "₀": "_{0}", "₁": "_{1}", "₂": "_{2}", "₃": "_{3}", "₄": "_{4}",
  "₅": "_{5}", "₆": "_{6}", "₇": "_{7}", "₈": "_{8}", "₉": "_{9}",
};

function parseEquationLines(verbatim: string) {
  const lines = verbatim.split(/\n+/).map((line) => line.trim().replace(/[.!?]+$/, ""))
    .filter(Boolean);
  if (lines.length < 2) return null;

  const equations = lines.map((line) => {
    const normalized = [...line].map((character) => unicodeSubscripts[character] ?? character)
      .join("").replace(/[−–]/g, "-").replace(/×/g, String.raw`\times `);
    const match = normalized.match(/^(.+?)\s*(=|≤|≥|≈|≠)\s*(.+)$/);
    if (!match || !/^[A-Za-z0-9_{}^+\-*/().,\\\s]+$/.test(match[1]) || !/^[A-Za-z0-9_{}^+\-*/().,\\\s]+$/.test(match[3])) return null;
    const relations: Record<string, string> = { "=": "=", "≤": String.raw`\leq`, "≥": String.raw`\geq`, "≈": String.raw`\approx`, "≠": String.raw`\ne` };
    const relation = relations[match[2]];
    return `${match[1].replace(/\s+/g, " ").trim()} &${relation} ${match[3].replace(/\s+/g, " ").trim()}`;
  });
  if (equations.some((line) => !line)) return null;
  return String.raw`\begin{aligned}` + equations.join(String.raw`\\`) + String.raw`\end{aligned}`;
}

/** Rebuild only broken aligned LaTeX when every source transcription line is unambiguous. */
export function repairAlignedEquations(note: SemanticNote) {
  const repairedIds: string[] = [];
  const blocks = note.blocks.map((block: NoteBlock) => {
    if (!block.math || !/\\begin\{aligned\}/.test(block.math.latex)) return block;
    const repairedLatex = parseEquationLines(block.text);
    if (!repairedLatex || repairedLatex === block.math.latex) return block;

    repairedIds.push(block.id);
    const reason = "LaTeX was rebuilt from the clear line-by-line transcription; verify the equations against the original page.";
    return {
      ...block,
      needsReview: true,
      reviewReason: [block.reviewReason, reason].filter(Boolean).join(" "),
      math: {
        ...block.math,
        latex: repairedLatex,
        mathml: undefined,
        mathmlError: undefined,
        structureWarning: undefined,
      },
    };
  });
  return { note: repairedIds.length ? { ...note, blocks } : note, repairedIds };
}
