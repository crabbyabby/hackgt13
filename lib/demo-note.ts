import type { SemanticNote } from "./domain/note";

export function createDemoNote(sourceName = "linear-algebra-notes.pdf"): SemanticNote {
  const now = new Date().toISOString();
  return {
    id: "note_demo_eigenvectors",
    slug: "linear-algebra-eigenvectors",
    title: "Eigenvalues and eigenvectors",
    course: "MATH 1554 · Linear Algebra",
    source: { name: sourceName, kind: sourceName.toLowerCase().endsWith(".pdf") ? "pdf" : "image", pageCount: 2 },
    status: "draft",
    createdAt: now,
    updatedAt: now,
    blocks: [
      { id: "b1", kind: "heading", text: "Eigenvalues and eigenvectors", confidence: 0.99, needsReview: false, sourceRegion: { page: 1, x: 8, y: 8, width: 70, height: 9 } },
      { id: "b2", kind: "paragraph", text: "A nonzero vector x is an eigenvector of a square matrix A when applying A changes its scale but not its direction.", confidence: 0.94, needsReview: false, sourceRegion: { page: 1, x: 8, y: 21, width: 80, height: 17 } },
      { id: "b3", kind: "equation", text: "The defining eigenvalue equation.", confidence: 0.88, needsReview: true, math: { latex: "A x = \\lambda x", spoken: "A times x equals lambda times x", label: "Eigenvalue equation", variables: [{ symbol: "A", meaning: "Square matrix or linear transformation" }, { symbol: "x", meaning: "Nonzero eigenvector" }, { symbol: "λ", meaning: "Eigenvalue; the scale factor" }] }, sourceRegion: { page: 1, x: 18, y: 42, width: 45, height: 11 } },
      { id: "b4", kind: "graph", title: "Vector transformation diagram", text: "The diagram compares x with A x.", altText: "Two vectors start at the origin and point in the same direction. A x is longer than x, illustrating a positive eigenvalue greater than one.", confidence: 0.81, needsReview: true, sourceRegion: { page: 2, x: 9, y: 12, width: 62, height: 42 } },
      { id: "b5", kind: "annotation", text: "Common mistake: x cannot be the zero vector.", confidence: 0.91, needsReview: false, sourceRegion: { page: 2, x: 10, y: 70, width: 68, height: 10 } },
    ],
  };
}
