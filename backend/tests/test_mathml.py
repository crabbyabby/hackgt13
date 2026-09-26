from backend.app.document_processing.mathml import build_expression_tree, compile_math, speak_latex


def test_valid_latex_compiles_to_mathml():
    result = compile_math(r"A x = \lambda x")

    assert result.ok is True
    assert result.error is None
    assert result.mathml is not None
    assert result.mathml.startswith("<math")
    assert "MathML" in result.mathml


def test_malformed_latex_fails_instead_of_emitting_broken_notation():
    result = compile_math(r"\frac{a}{")

    assert result.ok is False
    assert result.mathml is None
    assert result.error is not None
    assert "did not compile" in result.error


def test_empty_latex_is_a_failure_not_an_empty_equation():
    result = compile_math("   ")

    assert result.ok is False
    assert result.mathml is None


def test_fraction_exposes_numerator_and_denominator():
    tree = build_expression_tree(r"\frac{a+b}{c^2}")

    assert tree is not None
    assert tree.numerator is not None and tree.numerator.latex == "a+b"
    assert tree.denominator is not None and tree.denominator.latex == "c^2"
    # The denominator is itself navigable.
    assert tree.denominator.base is not None and tree.denominator.base.latex == "c"
    assert tree.denominator.exponent is not None and tree.denominator.exponent.latex == "2"


def test_root_exposes_radicand_and_index():
    tree = build_expression_tree(r"\sqrt[3]{x^2}")

    assert tree is not None
    assert tree.rootIndex is not None and tree.rootIndex.latex == "3"
    assert tree.radicand is not None and tree.radicand.latex == "x^2"


def test_matrix_exposes_rows_and_columns_for_navigation():
    tree = build_expression_tree(r"\begin{pmatrix}a & b\\c & d\end{pmatrix}")

    assert tree is not None
    assert [[cell.latex for cell in row] for row in tree.matrixRows] == [["a", "b"], ["c", "d"]]
    assert [[cell.latex for cell in column] for column in tree.matrixColumns] == [["a", "c"], ["b", "d"]]


def test_aligned_derivation_is_split_into_steps():
    tree = build_expression_tree(r"\begin{aligned}a &= b\\ b &= c\end{aligned}")

    assert tree is not None
    assert len(tree.alignedSteps) == 2


def test_spoken_fallback_replaces_commands_with_words():
    spoken = speak_latex(r"\lambda x")

    assert "lambda" in spoken
    assert "\\" not in spoken


def test_compilation_is_deterministic():
    first = compile_math(r"\frac{1}{2}")
    second = compile_math(r"\frac{1}{2}")

    assert first.mathml == second.mathml
