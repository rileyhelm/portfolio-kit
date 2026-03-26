from utils.content import markdown_to_html


def test_markdown_to_html_renders_row_blocks_as_columns() -> None:
  markdown = "\n".join(
    [
      "<!-- row -->",
      "### Left",
      "",
      "Left body.",
      "<!-- col -->",
      '<figure class="portfolio-image align-center">',
      '<img src="/static/example.svg" alt="Example" style="max-width:72%;">',
      "</figure>",
      "<!-- /row -->",
    ]
  )

  html = markdown_to_html(markdown)

  assert 'content-block content-block-row' in html
  assert 'content-row' in html
  assert 'content-col content-col-left' in html
  assert 'content-col content-col-right' in html
  assert '<h3 id="left">Left</h3>' in html
  assert 'portfolio-image align-center' in html
