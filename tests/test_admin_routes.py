from __future__ import annotations

from pathlib import Path

from dependencies import COOKIE_NAME, sign_cookie


def auth_client(client):
  client.cookies.set(COOKIE_NAME, sign_cookie("editor"))
  return client


def test_admin_endpoints_require_auth(client) -> None:
  response = client.post("/api/create-project", json={"slug": "blocked-project", "name": "Blocked Project"})
  assert response.status_code == 403


def test_create_project(client, content_dir: Path) -> None:
  response = auth_client(client).post(
    "/api/create-project",
    json={
      "slug": "sample-project",
      "name": "Sample Project",
      "date": "2026-01-01",
      "draft": False,
      "markdown": "Hello world",
    },
  )

  assert response.status_code == 200
  assert response.json()["slug"] == "sample-project"
  saved_file = content_dir / "projects" / "sample-project.md"
  assert saved_file.exists()
  assert "name: Sample Project" in saved_file.read_text(encoding="utf-8")


def test_save_project(client, content_dir: Path) -> None:
  project_file = content_dir / "projects" / "sample-project.md"
  project_file.write_text(
    """---
name: Sample Project
slug: sample-project
date: 2026-01-01
draft: false
---

Original text.
""",
    encoding="utf-8",
  )

  get_response = auth_client(client).get("/api/project/sample-project")
  assert get_response.status_code == 200
  revision = get_response.json()["revision"]

  save_response = auth_client(client).post(
    "/api/save-project",
    json={
      "slug": "sample-project",
      "original_slug": "sample-project",
      "name": "Sample Project Updated",
      "date": "2026-01-01",
      "draft": False,
      "thumbnail": "/static/seed/project-studio/thumb.svg",
      "youtube": "",
      "markdown": "Updated text",
      "base_revision": revision,
    },
  )

  assert save_response.status_code == 200
  saved = project_file.read_text(encoding="utf-8")
  assert "name: Sample Project Updated" in saved
  assert "Updated text" in saved


def test_save_about(client, content_dir: Path) -> None:
  response = auth_client(client).get("/api/about")
  assert response.status_code == 200
  revision = response.json()["revision"]
  settings_revision = response.json()["settings_revision"]

  save_response = auth_client(client).post(
    "/api/save-about",
    json={
      "markdown": "Updated about text.",
      "base_revision": revision,
      "settings_base_revision": settings_revision,
      "settings": {
        "site_name": "Updated Site",
        "owner_name": "Updated Owner",
        "tagline": "Updated Tagline",
        "about_photo": "/static/seed/about/profile.svg",
        "contact_email": "hello@example.com",
        "social_links": [{"label": "Email", "url": "mailto:hello@example.com"}],
      },
    },
  )

  assert save_response.status_code == 200
  assert save_response.json()["settings_revision"]
  about_file = content_dir / "about.md"
  settings_file = content_dir / "settings.json"
  assert "Updated about text." in about_file.read_text(encoding="utf-8")
  assert "Updated Site" in settings_file.read_text(encoding="utf-8")


def test_save_project_conflict_returns_full_server_state(client, content_dir: Path) -> None:
  project_file = content_dir / "projects" / "sample-project.md"
  project_file.write_text(
    """---
name: Sample Project
slug: sample-project
date: 2026-01-01
draft: false
---

Original text.
""",
    encoding="utf-8",
  )

  revision = auth_client(client).get("/api/project/sample-project").json()["revision"]
  project_file.write_text(
    """---
name: Renamed On Server
slug: sample-project
date: 2026-01-01
draft: false
thumbnail: /static/server-thumb.svg
---

Server text.
""",
    encoding="utf-8",
  )

  response = auth_client(client).post(
    "/api/save-project",
    json={
      "slug": "sample-project",
      "original_slug": "sample-project",
      "name": "Local Draft",
      "date": "2026-01-01",
      "draft": False,
      "markdown": "Local text",
      "base_revision": revision,
    },
  )

  assert response.status_code == 409
  payload = response.json()
  assert payload["conflict"] is True
  assert payload["server_project"]["name"] == "Renamed On Server"
  assert payload["server_project"]["thumbnail"] == "/static/server-thumb.svg"
  assert payload["server_project"]["markdown"] == "Server text."


def test_save_about_detects_settings_conflict(client, content_dir: Path) -> None:
  response = auth_client(client).get("/api/about")
  assert response.status_code == 200
  revision = response.json()["revision"]
  settings_revision = response.json()["settings_revision"]

  settings_file = content_dir / "settings.json"
  settings_file.write_text(
    """{
  "site_name": "Server Updated Site",
  "owner_name": "Test Owner",
  "tagline": "Testing",
  "about_photo": "/static/server-photo.svg",
  "contact_email": null,
  "social_links": []
}
""",
    encoding="utf-8",
  )

  save_response = auth_client(client).post(
    "/api/save-about",
    json={
      "markdown": "Updated about text.",
      "base_revision": revision,
      "settings_base_revision": settings_revision,
      "settings": {
        "site_name": "Local Site",
        "owner_name": "Updated Owner",
        "tagline": "Updated Tagline",
        "about_photo": "/static/local-photo.svg",
        "contact_email": "hello@example.com",
        "social_links": [],
      },
    },
  )

  assert save_response.status_code == 409
  payload = save_response.json()
  assert payload["conflict"] is True
  assert payload["server_state"]["settings"]["site_name"] == "Server Updated Site"
  assert payload["server_state"]["settings"]["about_photo"] == "/static/server-photo.svg"
  assert payload["server_settings_revision"]


def test_edit_nav_shows_contextual_action_only(client, content_dir: Path) -> None:
  project_file = content_dir / "projects" / "sample-project.md"
  project_file.write_text(
    """---
name: Sample Project
slug: sample-project
date: 2026-01-01
draft: false
---

Project body.
""",
    encoding="utf-8",
  )

  home_response = auth_client(client).get("/")
  assert home_response.status_code == 200
  assert "New Project" in home_response.text
  assert "data-open-about-editor" not in home_response.text
  assert 'href="/sample-project?edit=1"' in home_response.text
  assert 'data-open-project-editor="sample-project"' not in home_response.text
  assert 'data-delete-project="sample-project"' not in home_response.text

  about_response = auth_client(client).get("/me")
  assert about_response.status_code == 200
  assert "data-open-about-editor" in about_response.text
  assert ">Edit</button>" in about_response.text
  assert "New Project" not in about_response.text

  project_response = auth_client(client).get("/sample-project")
  assert project_response.status_code == 200
  assert "New Project" not in project_response.text
  assert "data-open-about-editor" not in project_response.text


def test_footer_renders_supported_social_icons_only(client, content_dir: Path) -> None:
  settings_file = content_dir / "settings.json"
  settings_file.write_text(
    """{
  "site_name": "Test Portfolio",
  "owner_name": "Test Owner",
  "tagline": "Testing",
  "about_photo": null,
  "contact_email": null,
  "social_links": [
    {"label": "Instagram", "url": "https://instagram.com/test"},
    {"label": "YouTube", "url": "https://www.youtube.com/@test"},
    {"label": "Email", "url": "mailto:test@example.com"}
  ]
}
""",
    encoding="utf-8",
  )

  response = client.get("/")

  assert response.status_code == 200
  assert 'aria-label="Instagram"' in response.text
  assert 'aria-label="YouTube"' in response.text
  assert 'aria-label="Email"' not in response.text
  assert '>Instagram<' not in response.text
