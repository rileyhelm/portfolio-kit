from __future__ import annotations

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import HTMLResponse, RedirectResponse

from dependencies import (
    COOKIE_MAX_AGE,
    COOKIE_NAME,
    get_edit_token,
    is_edit_mode,
    sign_cookie,
)


router = APIRouter(prefix="/edit", tags=["auth"])


LOGIN_HTML = """<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Edit Login</title>
  <style>
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      background:
        radial-gradient(circle at top, rgba(224, 208, 178, 0.28), transparent 40%),
        linear-gradient(180deg, #f7f2ea, #efe5d6 55%, #e7dbc8);
      color: #201a12;
      font: 16px/1.4 "Public Sans", system-ui, sans-serif;
    }
    form {
      width: min(360px, calc(100vw - 32px));
      padding: 28px;
      border-radius: 20px;
      border: 1px solid rgba(32, 26, 18, 0.12);
      background: rgba(255, 252, 246, 0.92);
      box-shadow: 0 24px 60px rgba(57, 44, 25, 0.12);
    }
    h1 {
      margin: 0 0 6px;
      font: 600 1.4rem/1.1 "Newsreader", serif;
    }
    p {
      margin: 0 0 16px;
      color: rgba(32, 26, 18, 0.72);
    }
    input, button {
      width: 100%;
      border-radius: 12px;
      font: inherit;
    }
    input {
      padding: 12px 14px;
      margin-bottom: 12px;
      border: 1px solid rgba(32, 26, 18, 0.16);
      background: white;
    }
    button {
      padding: 12px 14px;
      border: none;
      background: #201a12;
      color: white;
      cursor: pointer;
    }
    .error {
      margin-bottom: 12px;
      color: #9a2f1d;
    }
  </style>
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Newsreader:wght@500;600&family=Public+Sans:wght@400;500;600&display=swap" rel="stylesheet">
</head>
<body>
  <form method="post" action="/edit/login">
    <h1>Edit Mode</h1>
    <p>Enter the edit token to manage projects, uploads, and the about page.</p>
    {error}
    <input type="password" name="token" autocomplete="current-password" placeholder="Edit token" autofocus>
    <button type="submit">Enter</button>
  </form>
</body>
</html>"""


@router.get("/login", response_class=HTMLResponse)
async def login_page(request: Request, error: int = 0):
    if not get_edit_token():
        raise HTTPException(status_code=404)
    if is_edit_mode(request):
        return RedirectResponse("/", status_code=303)

    error_html = '<p class="error">Invalid token</p>' if error else ""
    return HTMLResponse(LOGIN_HTML.replace("{error}", error_html))


@router.post("/login")
async def login(request: Request):
    if not get_edit_token():
        raise HTTPException(status_code=404)

    form = await request.form()
    token = str(form.get("token", ""))
    if token != get_edit_token():
        return RedirectResponse("/edit/login?error=1", status_code=303)

    response = RedirectResponse("/", status_code=303)
    response.set_cookie(
        COOKIE_NAME,
        sign_cookie("editor"),
        max_age=COOKIE_MAX_AGE,
        httponly=True,
        secure=request.url.scheme == "https",
        samesite="strict",
    )
    return response


@router.get("/logout")
async def logout():
    response = RedirectResponse("/", status_code=303)
    response.delete_cookie(COOKIE_NAME)
    return response

