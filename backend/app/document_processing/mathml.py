"""Deterministic LaTeX compilation: MathML output, validation, and a navigable tree.

This module never calls a model. It is the objective half of the extraction pipeline:
a transcription whose LaTeX does not compile is evidence of a bad read, independent of
whatever confidence the model reported about itself.

It produces three things from one LaTeX string:

1. MathML, which is what a screen reader actually consumes (WCAG 2.1 SC 1.3.1). The
   reader and every downloadable artifact render this instead of raw LaTeX source.
2. A pass/fail signal. Malformed LaTeX cannot be rendered accessibly, so it is forced
   back to human review rather than published.
3. A `MathExpressionNode` tree so a reader can navigate into parts of an expression
   ("read the numerator", "read row two") instead of hearing one flat utterance.
"""

from __future__ import annotations

import re
from dataclasses import dataclass

import latex2mathml.converter
from pylatexenc.latexwalker import (
    LatexEnvironmentNode,
    LatexMacroNode,
    LatexWalker,
)

from backend.app.domain.models import MathExpressionNode

MATRIX_ENVIRONMENTS = frozenset(
    {"matrix", "pmatrix", "bmatrix", "Bmatrix", "vmatrix", "Vmatrix", "smallmatrix", "array"}
)
ALIGNED_ENVIRONMENTS = frozenset({"align", "align*", "aligned", "gather", "gather*", "split", "eqnarray"})

# Spoken fallbacks for symbols a screen reader would otherwise pronounce as a backslash
# command. The transcription model supplies prose for whole expressions; this only has to
# make an individual sub-expression intelligible when a reader navigates into it.
_SPOKEN_SYMBOLS = {
    r"\lambda": "lambda", r"\alpha": "alpha", r"\beta": "beta", r"\gamma": "gamma",
    r"\delta": "delta", r"\theta": "theta", r"\mu": "mu", r"\sigma": "sigma",
    r"\pi": "pi", r"\phi": "phi", r"\omega": "omega", r"\epsilon": "epsilon",
    r"\Delta": "capital delta", r"\Sigma": "capital sigma", r"\Omega": "capital omega",
    r"\times": "times", r"\cdot": "times", r"\div": "divided by", r"\pm": "plus or minus",
    r"\leq": "less than or equal to", r"\geq": "greater than or equal to",
    r"\neq": "not equal to", r"\approx": "approximately", r"\infty": "infinity",
    r"\rightarrow": "goes to", r"\to": "goes to", r"\in": "in", r"\sum": "sum",
    r"\int": "integral", r"\partial": "partial", r"\nabla": "del",
    "=": " equals ", "+": " plus ", "-": " minus ", "<": " less than ", ">": " greater than ",
}


@dataclass(frozen=True, slots=True)
class MathCompilation:
    """The deterministic result of compiling one LaTeX string."""

    latex: str
    mathml: str | None
    tree: MathExpressionNode | None
    ok: bool
    error: str | None = None
    # Set when the LaTeX parses but describes the wrong mathematics, which a syntax
    # check alone cannot see. Compiling is necessary but not sufficient.
    structureWarning: str | None = None


# A matrix written with a real environment; anything else loses its two dimensions.
_MATRIX_ENVIRONMENT = re.compile(r"\\begin\{(p|b|B|v|V|small)?matrix\*?\}|\\begin\{array\}|\\\\")
# The observed failure mode: brackets enclosing either an augmentation rule, or two or
# more row separators, e.g. "[3; -2; -1; 0]" and "[3 2 0 1 3 | 5; ...]". One semicolon
# inside brackets is ordinary notation such as an ordered pair, so it is left alone.
_FLATTENED_MATRIX = re.compile(r"[\[(](?:[^\[\]()]*\|[^\[\]()]*|[^\[\]()]*;[^\[\]()]*;[^\[\]()]*)[\])]", re.DOTALL)


def compile_math(latex: str) -> MathCompilation:
    """Convert LaTeX to MathML and a navigable tree. Never raises."""
    source = (latex or "").strip()
    if not source:
        return MathCompilation(latex=latex or "", mathml=None, tree=None, ok=False, error="No LaTeX was provided.")
    try:
        mathml = latex2mathml.converter.convert(source)
    except Exception as exc:  # noqa: BLE001 - any parse failure is the same signal: needs review
        reason = str(exc).strip() or type(exc).__name__
        return MathCompilation(
            latex=source, mathml=None, tree=None, ok=False, error=f"LaTeX did not compile to MathML: {reason}"
        )
    return MathCompilation(
        latex=source,
        mathml=mathml,
        tree=build_expression_tree(source),
        ok=True,
        structureWarning=detect_flattened_matrix(source),
    )


def detect_flattened_matrix(latex: str) -> str | None:
    """Flag a matrix or vector written as an inline list instead of a real environment.

    `[3; -2; -1; 0]` is valid LaTeX and compiles to valid MathML, so the compile gate
    passes it. But it carries no rows or columns, so a screen reader announces a run of
    numbers rather than a column vector: the notation parses and still states the wrong
    mathematics. Structure has to be checked separately from syntax.
    """
    source = (latex or "").strip()
    if not source or _MATRIX_ENVIRONMENT.search(source):
        return None
    if _FLATTENED_MATRIX.search(source):
        return (
            "Notation looks like a matrix or vector flattened into an inline list. "
            "It should use a matrix environment so rows and columns survive."
        )
    return None


def speak_latex(latex: str) -> str:
    """Best-effort spoken rendering of a sub-expression.

    Deliberately shallow: it exists so navigating into a part of an expression says
    something intelligible, not to replace model-generated narration for whole equations.
    """
    text = (latex or "").strip()
    if not text:
        return ""
    for macro in (r"\left", r"\right", r"\,", r"\;", r"\!", r"\quad", r"\qquad"):
        text = text.replace(macro, " ")
    for environment in MATRIX_ENVIRONMENTS:
        text = text.replace(rf"\begin{{{environment}}}", " matrix ").replace(rf"\end{{{environment}}}", " ")
    for environment in ALIGNED_ENVIRONMENTS:
        text = text.replace(rf"\begin{{{environment}}}", " ").replace(rf"\end{{{environment}}}", " ")
    text = text.replace(r"\frac", " fraction ").replace(r"\sqrt", " square root of ")
    for symbol, spoken in _SPOKEN_SYMBOLS.items():
        text = text.replace(symbol, f" {spoken} " if symbol.startswith("\\") else spoken)
    text = text.replace("^", " to the power ").replace("_", " sub ").replace("&", " ")
    text = text.replace("{", " ").replace("}", " ").replace("\\", " ")
    return " ".join(text.split())


def build_expression_tree(latex: str) -> MathExpressionNode | None:
    """Decompose LaTeX into navigable parts. Returns a leaf node when there is no structure."""
    source = (latex or "").strip()
    if not source:
        return None
    node = MathExpressionNode(latex=source, spoken=speak_latex(source))

    aligned = _split_aligned(source)
    if aligned is not None:
        node.alignedSteps = [_leaf_or_tree(step) for step in aligned]
        return node

    matrix = _split_matrix(source)
    if matrix is not None:
        node.matrixRows = [[_leaf_or_tree(cell) for cell in row] for row in matrix]
        node.matrixColumns = [
            [_leaf_or_tree(row[index]) for row in matrix if index < len(row)]
            for index in range(max((len(row) for row in matrix), default=0))
        ]
        return node

    macro = _leading_macro(source)
    if macro is not None:
        name, arguments, consumed_whole = macro
        if name == "frac" and len(arguments) == 2 and consumed_whole:
            node.numerator = _leaf_or_tree(arguments[0])
            node.denominator = _leaf_or_tree(arguments[1])
            return node
        if name == "sqrt" and arguments and consumed_whole:
            # pylatexenc yields the optional root index first when it is present.
            if len(arguments) == 2 and arguments[0]:
                node.rootIndex = _leaf_or_tree(arguments[0])
                node.radicand = _leaf_or_tree(arguments[1])
            else:
                node.radicand = _leaf_or_tree(arguments[-1])
            return node

    power = _split_power(source)
    if power is not None:
        base, exponent = power
        node.base = _leaf_or_tree(base)
        node.exponent = _leaf_or_tree(exponent)
    return node


def _leaf_or_tree(latex: str) -> MathExpressionNode:
    return build_expression_tree(latex) or MathExpressionNode(latex=latex, spoken=speak_latex(latex))


def _strip_outer_braces(value: str) -> str:
    text = value.strip()
    while len(text) >= 2 and text[0] == "{" and text[-1] == "}" and _matches_at_end(text):
        text = text[1:-1].strip()
    return text


def _matches_at_end(text: str) -> bool:
    """True when the opening brace at index 0 is closed by the final character."""
    depth = 0
    for index, character in enumerate(text):
        if character == "{":
            depth += 1
        elif character == "}":
            depth -= 1
            if depth == 0:
                return index == len(text) - 1
    return False


def _split_top_level(value: str, separator: str) -> list[str]:
    """Split on a separator that appears at brace depth zero."""
    parts: list[str] = []
    depth = 0
    current = ""
    index = 0
    while index < len(value):
        character = value[index]
        if character == "\\" and value.startswith(separator, index) and separator.startswith("\\") and depth == 0:
            parts.append(current)
            current = ""
            index += len(separator)
            continue
        if character == "{":
            depth += 1
        elif character == "}":
            depth = max(0, depth - 1)
        elif depth == 0 and not separator.startswith("\\") and value.startswith(separator, index):
            parts.append(current)
            current = ""
            index += len(separator)
            continue
        current += character
        index += 1
    parts.append(current)
    return [part.strip() for part in parts]


def _environment_body(latex: str, names: frozenset[str]) -> tuple[str, str] | None:
    """Return (environment name, raw body) when the string is a single environment."""
    try:
        walker = LatexWalker(latex)
        nodes, _, _ = walker.get_latex_nodes()
    except Exception:  # noqa: BLE001 - malformed input is handled by the MathML gate
        return None
    environments = [node for node in nodes if isinstance(node, LatexEnvironmentNode)]
    if len(environments) != 1:
        return None
    environment = environments[0]
    if environment.environmentname not in names:
        return None
    children = environment.nodelist
    if not children:
        return "", ""
    start = children[0].pos
    end = children[-1].pos + children[-1].len
    return environment.environmentname, latex[start:end]


def _split_matrix(latex: str) -> list[list[str]] | None:
    found = _environment_body(latex, MATRIX_ENVIRONMENTS)
    if found is None:
        return None
    _, body = found
    rows = [row for row in _split_top_level(body, r"\\") if row]
    if not rows:
        return None
    return [[cell.strip() for cell in _split_top_level(row, "&")] for row in rows]


def _split_aligned(latex: str) -> list[str] | None:
    found = _environment_body(latex, ALIGNED_ENVIRONMENTS)
    if found is None:
        return None
    _, body = found
    steps = [step.replace("&", " ").strip() for step in _split_top_level(body, r"\\")]
    steps = [step for step in steps if step]
    return steps or None


def _leading_macro(latex: str) -> tuple[str, list[str], bool] | None:
    """Return (macro name, argument LaTeX, whether the macro spans the whole string)."""
    try:
        walker = LatexWalker(latex)
        nodes, _, _ = walker.get_latex_nodes()
    except Exception:  # noqa: BLE001
        return None
    if not nodes or not isinstance(nodes[0], LatexMacroNode):
        return None
    macro = nodes[0]
    arguments: list[str] = []
    if macro.nodeargd and macro.nodeargd.argnlist:
        for argument in macro.nodeargd.argnlist:
            if argument is None:
                arguments.append("")
                continue
            raw = latex[argument.pos : argument.pos + argument.len]
            arguments.append(_strip_outer_braces(raw).strip("[]").strip())
    spans_whole = len(nodes) == 1
    return macro.macroname, arguments, spans_whole


def _split_power(latex: str) -> tuple[str, str] | None:
    """Split `base^exponent` at brace depth zero. Subscripts stay part of the base."""
    depth = 0
    for index, character in enumerate(latex):
        if character == "{":
            depth += 1
        elif character == "}":
            depth = max(0, depth - 1)
        elif character == "^" and depth == 0:
            base = latex[:index].strip()
            exponent = _strip_outer_braces(latex[index + 1 :].strip())
            if base and exponent:
                return base, exponent
            return None
    return None
