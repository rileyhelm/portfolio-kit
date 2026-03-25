from __future__ import annotations

import re

from jinja2 import pass_context
from markupsafe import Markup


@pass_context
def escape_jinja2_in_code_snippets(_context, content: str | None) -> Markup:
    if not content:
        return Markup("")

    pattern = r"(<pre.*?>.*?</pre>)"

    def replace_code(match: re.Match[str]) -> str:
        snippet = match.group(1)
        return snippet.replace("{", "&#123;").replace("}", "&#125;")

    return Markup(re.sub(pattern, replace_code, content, flags=re.DOTALL))

