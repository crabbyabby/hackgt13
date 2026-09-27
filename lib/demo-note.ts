import type { MathNode, NoteBlock, SemanticNote } from "./domain/note";

const variables = {
  x: { symbol: "x_k", meaning: "The kth vector in the original basis" },
  v: { symbol: "v_k", meaning: "The kth orthogonal vector produced by Gram-Schmidt" },
  w: { symbol: "W_k", meaning: "The span of the first k basis vectors" },
};

function math(
  latex: string,
  spoken: string,
  label: string,
  mathVariables: MathNode["variables"] = [],
): MathNode {
  return { latex, spoken, label, variables: mathVariables };
}

function block(
  id: string,
  kind: NoteBlock["kind"],
  text: string,
  page: number,
  extras: Partial<NoteBlock> = {},
): NoteBlock {
  return {
    id,
    kind,
    text,
    confidence: 1,
    needsReview: false,
    sourceRegion: { page, x: 8, y: 8, width: 84, height: 12 },
    ...extras,
  };
}

/**
 * A faithful, editable semantic transcription of the two-page course handout
 * "6.4 Gram-Schmidt and QR Decomposition.pdf".
 *
 * It deliberately stops where the source stops: QR decomposition is named as an
 * objective, but the supplied pages do not yet contain a QR formula or worked example.
 */
export function createDemoNote(
  sourceName = "6.4 Gram-Schmidt and QR Decomposition.pdf",
): SemanticNote {
  const now = new Date().toISOString();
  return {
    id: "note_demo_gram_schmidt",
    slug: "gram-schmidt-and-qr-decomposition",
    title: "6.4 Gram-Schmidt and QR Decomposition",
    course: "Linear Algebra",
    source: {
      name: sourceName,
      kind: "pdf",
      pageCount: 2,
      aiProvider: "development",
      aiModel: "hardcoded-semantic-sample",
    },
    status: "draft",
    createdAt: now,
    updatedAt: now,
    blocks: [
      block("gs-topics-heading", "heading", "Objectives: Topics", 1),
      block(
        "gs-topics",
        "paragraph",
        "The topics are the Gram-Schmidt process and the QR decomposition.",
        1,
      ),
      block("gs-goals-heading", "heading", "Objectives: Goals", 1),
      block(
        "gs-goals",
        "paragraph",
        "Apply Gram-Schmidt and QR decomposition to construct orthogonal or orthonormal bases. Compute the QR factorization of a matrix.",
        1,
      ),
      block("gs-motivation-heading", "heading", "Motivating Question", 1),
      block(
        "gs-motivation-intro",
        "paragraph",
        "Identify an orthogonal basis for the subspace spanned by the following three vectors.",
        1,
      ),
      block("gs-motivation-vectors", "equation", "The three vectors that span the subspace.", 1, {
        math: math(
          String.raw`\vec{x}_1=\begin{bmatrix}1\\1\\1\\1\end{bmatrix},\qquad \vec{x}_2=\begin{bmatrix}0\\1\\1\\1\end{bmatrix},\qquad \vec{x}_3=\begin{bmatrix}0\\0\\1\\1\end{bmatrix}`,
          "Vector x one is the column vector one, one, one, one. Vector x two is the column vector zero, one, one, one. Vector x three is the column vector zero, zero, one, one.",
          "Motivating vectors",
          [{ symbol: "x_1, x_2, x_3", meaning: "Vectors spanning the starting subspace" }],
        ),
      }),
      block(
        "gs-theorem-heading",
        "heading",
        "Theorem 6.44: The Gram-Schmidt Process",
        1,
      ),
      block(
        "gs-theorem-intro",
        "paragraph",
        "Given a basis consisting of vectors x one through x p for a subspace W contained in R to the n, define the following orthogonal vectors.",
        1,
      ),
      block("gs-theorem-recursion", "equation", "The Gram-Schmidt recursive construction.", 1, {
        math: math(
          String.raw`\begin{aligned}
\vec{v}_1&=\vec{x}_1,\\
\vec{v}_2&=\vec{x}_2-\frac{\vec{x}_2\cdot\vec{v}_1}{\vec{v}_1\cdot\vec{v}_1}\vec{v}_1,\\
\vec{v}_3&=\vec{x}_3-\frac{\vec{x}_3\cdot\vec{v}_1}{\vec{v}_1\cdot\vec{v}_1}\vec{v}_1-\frac{\vec{x}_3\cdot\vec{v}_2}{\vec{v}_2\cdot\vec{v}_2}\vec{v}_2,\\
&\ \vdots\\
\vec{v}_p&=\vec{x}_p-\frac{\vec{x}_p\cdot\vec{v}_1}{\vec{v}_1\cdot\vec{v}_1}\vec{v}_1-\cdots-\frac{\vec{x}_p\cdot\vec{v}_{p-1}}{\vec{v}_{p-1}\cdot\vec{v}_{p-1}}\vec{v}_{p-1}.
\end{aligned}`,
          "V one equals x one. V two equals x two minus the projection coefficient x two dot v one over v one dot v one, times v one. V three equals x three minus its projection onto v one and minus its projection onto v two. Continue in this way through v p, subtracting the components in every earlier v direction.",
          "Gram-Schmidt formula",
          [variables.x, variables.v],
        ),
      }),
      block(
        "gs-theorem-result",
        "paragraph",
        "Then the vectors v one through v p form an orthogonal basis for W. Additionally, the first k orthogonal vectors span the same subspace as the first k original basis vectors.",
        1,
      ),
      block("gs-span-identity", "equation", "The spans agree at every stage.", 1, {
        math: math(
          String.raw`W_k=\operatorname{Span}\{\vec{v}_1,\ldots,\vec{v}_k\}=\operatorname{Span}\{\vec{x}_1,\ldots,\vec{x}_k\},\qquad 1\le k\le p`,
          "W sub k equals the span of v one through v k, which equals the span of x one through x k, for k from one through p.",
          "Span preservation formula",
          [variables.w, variables.x, variables.v],
        ),
      }),
      block(
        "gs-projection-explanation",
        "paragraph",
        "Each vector v k is formed by starting with x k and removing the orthogonal projection of x k onto the span of the earlier vectors.",
        1,
      ),
      block("gs-projection-form", "equation", "Gram-Schmidt written using projection operators.", 1, {
        math: math(
          String.raw`\vec{v}_k=\vec{x}_k-\operatorname{proj}_{W_{k-1}}\vec{x}_k=\vec{x}_k-\operatorname{proj}_{\vec{v}_1}\vec{x}_k-\cdots-\operatorname{proj}_{\vec{v}_{k-1}}\vec{x}_k`,
          "V k equals x k minus the projection of x k onto W sub k minus one. Equivalently, subtract from x k its projections onto v one through v k minus one.",
          "Projection formula",
          [variables.x, variables.v, variables.w],
        ),
      }),
      block(
        "gs-geometry",
        "graph",
        "Geometric interpretation of the Gram-Schmidt process.",
        2,
        {
          title: "Projection geometry",
          altText: "A translucent plane labeled W two contains the earlier subspace W one, drawn as a dashed line. The original vectors x one, x two, and x three are red. The orthogonal vectors v two and v three are blue. Vector v one equals x one. Dashed construction lines show the projection of x two onto W one and the projection of x three onto W two. Subtracting each projection leaves the new orthogonal direction.",
          imageUrl: "/samples/gram-schmidt/projection-geometry.png",
          sourceImageUrl: "/samples/gram-schmidt/page-2.png",
          sourceRegion: { page: 2, x: 12.8, y: 2, width: 74, height: 28.2 },
        },
      ),
      block(
        "gs-geometry-caption",
        "paragraph",
        "Vectors x one, x two, and x three are used to produce orthogonal vectors v one, v two, and v three by subtracting projections. Gram-Schmidt successively removes the components of each vector in the span of earlier vectors.",
        2,
      ),
      block("gs-example-heading", "heading", "Example 6.45", 2),
      block("gs-example-subspace", "equation", "The subspace in Example 6.45.", 2, {
        math: math(
          String.raw`W=\operatorname{Span}\left\{\begin{bmatrix}3\\0\\-1\end{bmatrix},\begin{bmatrix}8\\5\\-6\end{bmatrix}\right\}`,
          "W is the span of the column vector three, zero, negative one, and the column vector eight, five, negative six.",
          "Example subspace",
          [{ symbol: "W", meaning: "The subspace for which an orthogonal basis is requested" }],
        ),
      }),
      block(
        "gs-example-prompt",
        "paragraph",
        "Find an orthogonal basis for W.",
        2,
      ),
    ],
  };
}

/** Add newly bundled visual assets to demo drafts saved by older app versions. */
export function hydrateDemoNoteAssets(note: SemanticNote): SemanticNote {
  if (note.id !== "note_demo_gram_schmidt") return note;
  return {
    ...note,
    blocks: note.blocks.map((candidate) => {
      if (candidate.id !== "gs-geometry") return candidate;
      const legacyRegion = candidate.sourceRegion;
      const usesLegacyCrop = legacyRegion?.x === 16 && legacyRegion.y === 5
        && legacyRegion.width === 68 && legacyRegion.height === 36;
      return {
        ...candidate,
        kind: "graph",
        imageUrl: "/samples/gram-schmidt/projection-geometry.png",
        sourceImageUrl: "/samples/gram-schmidt/page-2.png",
        sourceRegion: usesLegacyCrop
          ? { page: 2, x: 12.8, y: 2, width: 74, height: 28.2 }
          : candidate.sourceRegion,
      };
    }),
  };
}
