from __future__ import annotations

from pathlib import Path


CONTENT = {
    "about.md": """---
title: About
---

Replace this sample copy with your own story, process, and contact details.
""",
    "settings.json": """{
  "site_name": "Starter Portfolio",
  "owner_name": "Alex Morgan",
  "tagline": "A simple creative portfolio.",
  "about_photo": "/static/seed/about/profile.svg",
  "contact_email": "hello@example.com",
  "social_links": [
    {
      "label": "Instagram",
      "url": "https://instagram.com/example"
    }
  ]
}
""",
}


def main() -> None:
    root = Path(__file__).resolve().parents[1] / "content"
    root.mkdir(parents=True, exist_ok=True)
    for relative, value in CONTENT.items():
        path = root / relative
        path.write_text(value, encoding="utf-8")
        print(f"Wrote {path}")


if __name__ == "__main__":
    main()
