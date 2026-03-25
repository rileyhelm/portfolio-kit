from __future__ import annotations

from pathlib import Path
import sys

import pytest
from fastapi.testclient import TestClient


ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
  sys.path.insert(0, str(ROOT))


@pytest.fixture
def content_dir(tmp_path: Path) -> Path:
  content_root = tmp_path / "content"
  (content_root / "projects").mkdir(parents=True)
  (content_root / "settings.json").write_text(
    """{
  "site_name": "Test Portfolio",
  "owner_name": "Test Owner",
  "tagline": "Testing",
  "about_photo": null,
  "contact_email": null,
  "social_links": []
}
""",
    encoding="utf-8",
  )
  (content_root / "about.md").write_text(
    "---\ntitle: About\n---\n\nInitial about text.\n",
    encoding="utf-8",
  )
  (content_root / "assets.json").write_text(
    '{"version": 1, "assets": {}, "hash_index": {}}',
    encoding="utf-8",
  )
  return content_root


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch, tmp_path: Path, content_dir: Path) -> TestClient:
  monkeypatch.setenv("PORTFOLIO_CONTENT_DIR", str(content_dir))
  monkeypatch.setenv("PORTFOLIO_UPLOADS_DIR", str(tmp_path / "uploads"))
  monkeypatch.setenv("EDIT_TOKEN", "test-token")
  monkeypatch.setenv("COOKIE_SECRET", "test-secret")
  monkeypatch.setenv("LOCALHOST_EDIT_BYPASS", "false")
  monkeypatch.setenv("CONTENT_STARTUP_SYNC_POLICY", "off")

  from main import create_app

  app = create_app()
  with TestClient(app) as test_client:
    yield test_client
