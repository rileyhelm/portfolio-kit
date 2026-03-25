# SETUP.md

These steps assume this directory is the project root.

## One-time setup
1. Create a new repo for this site.
2. Copy this project into that repo or make this directory the repo root.
3. Copy `.env.example` to `.env`.
4. Set:
   - `EDIT_TOKEN`
   - `COOKIE_SECRET`
   - S3/CDN vars if you want hosted editing with durable uploads
5. Install Python dependencies.
6. Install frontend dependencies.
7. Build the frontend bundle.
8. Run the app locally.
9. Confirm the sample homepage, project pages, and `/me` page load.
10. Log in at `/edit/login`.
11. Replace the sample content and images.

## Production setup
12. Create an S3 bucket and CDN if you want hosted editing to persist uploads/content.
13. Add the same env vars in your host.
14. Deploy.
15. Test:
    - homepage
    - a project page
    - `/me`
    - `/edit/login`
    - image upload
    - save project
    - save about

## Normal content workflow
16. Log in at `/edit/login`.
17. Edit the about page or a project.
18. Upload images from the editor.
19. Save.
20. Refresh the public page and confirm the change.

## Working with a coding agent
21. Open a new chat in the repo.
22. Tell the agent to work only inside the project root.
23. Point it to:
    - `README.md`
    - `README_AGENT.md`
    - `SETUP.md`
24. Describe the change in plain language.
25. Ask it to implement, test, and summarize the result.

## Good requests to give the agent
- “Replace the sample projects with my real work.”
- “Adjust the homepage card layout.”
- “Add a new social link.”
- “Change the typography and colors.”
- “Add a contact section to `/me`.”
- “Improve the mobile spacing.”
