"""CI contract C4 — read/write split, the positive half (RFC-0005 §7, HANDOFF §3.8).

import-linter's "forbidden" contract type only expresses the negative half (`financeos.app`
must not import `financeos.adapters.duckdb.queries`, already contract C4 in `pyproject.toml`).
import-linter has no "only X may import Y" contract type, so the positive half — *only*
`financeos.web` may import `adapters.duckdb.queries` — is enforced here as a source scan.
"""

from __future__ import annotations

import ast
from pathlib import Path

SRC = Path(__file__).resolve().parents[1] / "src" / "financeos"
QUERIES_MODULE = "financeos.adapters.duckdb.queries"


def _imports_queries(tree: ast.Module) -> bool:
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            if any(alias.name.startswith(QUERIES_MODULE) for alias in node.names):
                return True
        elif isinstance(node, ast.ImportFrom) and node.module:
            if node.module.startswith(QUERIES_MODULE):
                return True
    return False


def test_only_web_imports_the_read_side_query_modules() -> None:
    violations = []
    for path in SRC.rglob("*.py"):
        if "__pycache__" in path.parts:
            continue
        relative = path.relative_to(SRC)
        queries_pkg = ("adapters", "duckdb", "queries")
        if relative.parts[:1] == ("web",) or relative.parts[: len(queries_pkg)] == queries_pkg:
            continue  # web/ is the allowed importer; the module importing itself doesn't count
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        if _imports_queries(tree):
            violations.append(str(relative))
    assert not violations, (
        "C4 violated — only financeos.web may import adapters.duckdb.queries, "
        f"but these modules do too: {violations}"
    )
