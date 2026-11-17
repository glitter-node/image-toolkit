# AGENTS.md — Image Toolkit

## Purpose and Priorities

Image Toolkit is a local-first, self-hosted image processing application. Its normal installation runs on the user's own Windows, Linux, or macOS host, with the same Python, FastAPI, Uvicorn, and Pillow application in development and local production. A public service is an optional, separately planned deployment.

Prioritize a clear native installation, minimal dependencies, existing API and output compatibility, privacy, and preservation of user data. Read [README.md](README.md) and relevant source before changing commands or describing features. Explicit user instructions take priority over this guide.

## Architecture and Repository Map

- `app/main.py`: FastAPI app, lifespan, static mounts, root page, health route.
- `app/config.py`: Pydantic environment and optional `.env` settings.
- `app/routers/api.py`: inspection, immediate single/batch conversion, per-image edited batch; shared image-processing slot.
- `app/routers/jobs.py`: background job submission, history, status, cancellation, and download API.
- `app/services/images.py`: Pillow loading and transformation. Uploaded images are processed on the server, not solely in the browser.
- `app/services/jobs.py`: process-local job queue, SQLite metadata, input files, ZIP results, expiration, and restart recovery.
- `app/templates/index.html`, `app/static/css/`, `app/static/js/`, `app/lang/`: UI, styles, browser logic, and four translation files.
- `data/image-jobs/`: default runtime job store, including `jobs.sqlite3`; preserve it. `tests/`: existing Python test sources.
- `tools/windows/start-image-toolkit.ps1` and [Windows Auto-Start](docs/WINDOWS_AUTOSTART.md): optional current-user login startup.

The UI preview is approximate; Pillow generates the downloaded output. The default deployment uses one Uvicorn worker because job state and processing limits are process-local.

## Installation Agent Protocol

When asked to install, launch, troubleshoot, or configure auto-start, first establish the **target host OS and version**, whether commands run on the user's computer or a remote host, the shell, installation state, and desired localhost or remote access. Do not infer the user's installation platform from the Codex execution environment. Ask for a missing target OS if needed; use available conversation context before asking.

Use native PowerShell and `venv\Scripts\python.exe` on Windows 10/11; native shell and `venv/bin/python` on Linux/macOS. Use `requirements.txt`. Check the actual Python, virtual environment, and package availability on the confirmed target before claiming compatibility. The normal local installation needs no Docker, WSL2, Nginx, external database, or cloud service. On macOS, distinguish Intel and Apple Silicon codec availability rather than promising unverified support. Present the exact host-specific commands and intended changes before executing any installation action. For Windows login startup, use the linked documentation; never register a task unless the user explicitly requests that action.

## Editing and Development Conventions

Preserve the Python application structure, route names, request/response shapes, image output behavior, and existing settings. Avoid unnecessary refactoring, comments, and dependencies. Use English for user-visible strings in source. Keep `<html lang="en">`, external JavaScript files, and stylesheet files; do not add inline CSS or JavaScript. Respect the current CSS/JavaScript layout and the JSON translation files in `app/lang/`. Keep documentation synchronized with source, and do not modify application code for a documentation-only request.

## Project Data and Persistence

Preserve an existing `.env`, environment variables, `data/image-jobs`, SQLite database and WAL files, queued inputs, ZIP results, and user backups. Do not delete or reset user data without explicit approval. Changes to job creation, state transitions, expiry, cancellation, or restart recovery require careful review of existing data and failure paths. The default job data path is relative to the process working directory; launch from the project root or set `JOB_DATA_DIR` intentionally.

## Security and Privacy

Bind to `127.0.0.1` by default. The server receives uploaded images and processes them with Pillow. Immediate conversion responses are assembled in memory; background jobs persist inputs and ZIP results temporarily under `JOB_DATA_DIR`, with metadata in SQLite. Do not expose private paths, tokens, `.env`, or user images in reports. Do not impose public SaaS infrastructure or authentication requirements on a localhost installation. Preserve existing security headers and token checks. Treat LAN/public exposure as a distinct, user-requested scenario with its own access and transport review.

## Verification Policy

**Do not run Python or Playwright tests unless the user separately and explicitly requests them.** Without separate approval, do not start or restart the app, make live API or DB checks, install packages, automate a browser, run load tests, change system settings, or modify user data. The default work scope is source inspection, requested edits, and static review. The user performs actual browser verification. Never claim a test passed when it was not run. If the user authorizes specific verification, state exactly what was run and distinguish source review from runtime evidence.

## Documentation and Collaboration

Keep [README.md](README.md) aligned with current implementation. Separate Windows PowerShell, Linux shell, and macOS shell commands. Keep the [Windows Auto-Start guide](docs/WINDOWS_AUTOSTART.md) and its [script](tools/windows/start-image-toolkit.ps1) consistent. Preserve valid documentation and links when updating them. Prefer small, reviewable edits and explain remaining limitations plainly.

## Suggested Handoff Report

Report changed files, the substantive changes, how each claim matches source, what was not tested, and the smallest manual checks the user needs to perform.
