"""Render the design-system preview to a standalone file.

    uv run python -m financeos.web.preview

Writes ``docs/design/preview.html`` with static URLs rewritten to a relative
path, so the page opens straight from the filesystem with the network
disabled -- which is how the Local First promise (ADR-0008) gets checked by a
human rather than asserted in a document.

The served route at ``/design`` renders the same template from the same
fixture; this only changes where the static assets are looked up.
"""

from __future__ import annotations

import os
from pathlib import Path

from jinja2 import Environment, FileSystemLoader, select_autoescape

from financeos.web.design_fixture import preview_context
from financeos.web.labels import register_label_filters

WEB_DIR = Path(__file__).resolve().parent
TEMPLATES_DIR = WEB_DIR / "templates"
STATIC_DIR = WEB_DIR / "static"


def build_environment() -> Environment:
    """The Jinja environment the web layer uses. Autoescape on, always."""
    env = Environment(
        loader=FileSystemLoader(TEMPLATES_DIR),
        autoescape=select_autoescape(["html", "xml"]),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    register_label_filters(env)
    return env


def render(static_url: str) -> str:
    env = build_environment()
    template = env.get_template("design/preview.html")
    return template.render(static=static_url, fixture=preview_context())


def main() -> None:
    out_path = WEB_DIR.parents[1].parent / "docs" / "design" / "preview.html"
    out_path.parent.mkdir(parents=True, exist_ok=True)
    static_url = os.path.relpath(STATIC_DIR, out_path.parent).replace(os.sep, "/")
    out_path.write_text(render(static_url), encoding="utf-8")
    print(f"wrote {out_path} (static -> {static_url})")


if __name__ == "__main__":
    main()
