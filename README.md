# Image Toolkit v0.1.0

**Initial public release:** `v0.1.0` · [GitHub repository](https://github.com/glitter-node/image-toolkit)

**A local, self-hosted image conversion and editing tool powered by Python, FastAPI, Uvicorn, and Pillow.**

Image Toolkit lets you select images in a browser, preview edits, and download files processed by Pillow on your own computer or server. The same FastAPI application and Uvicorn entry point serve development and local production; development adds `--reload`. A local installation needs no Docker, WSL2, Nginx, cloud account, or external database.

## Choose a Workflow

- Select one image to inspect it or convert and download it immediately.
- Select several images to create a background job, check progress, cancel between images, and download a ZIP while the result remains available.
- Use the visual editor for a browser preview; the server output is authoritative. Presets can be exported to or imported from JSON files, while recent job credentials are stored in this browser.

## Key Features

- Content-based input detection for JPEG, PNG, WebP, GIF, BMP, TIFF, AVIF, and HEIF when their decoders are available. Animated images with multiple frames are rejected.
- JPEG, PNG, WebP, AVIF, and HEIC output, subject to installed codec support. Quality applies to JPEG, WebP, AVIF, and HEIC; PNG uses an optimization option.
- EXIF orientation normalization, crop, clockwise rotation, horizontal and vertical flip, resize, brightness, contrast, saturation, and sharpness. Cropping uses coordinates after EXIF normalization and before rotation. Output metadata is removed.
- Text watermark and optional PNG logo watermark. JPEG output composites transparency over white; formats that support alpha can retain it.
- Up to 10 files per batch, ZIP downloads, per-image job status, cooperative cancellation, and short-lived job history.
- Four UI languages: Korean, English, Japanese, and Simplified Chinese.

## Technology Stack

| Area | Implementation |
| --- | --- |
| Backend | Python, FastAPI, Pydantic settings |
| Image processing | Pillow; `pillow-heif` for HEIF/HEIC when its native dependencies load |
| Persistence | Python `sqlite3` for job metadata; local files for queued inputs and result ZIPs |
| Frontend | HTML, CSS, and vanilla JavaScript served by FastAPI |
| Application server | Uvicorn, one worker for the process-local job queue |
| Installation | `requirements.txt` includes runtime and test dependencies; Nginx/systemd are optional |

## Platform Support and Requirements

| Platform | Native installation path | Verification status |
| --- | --- | --- |
| Windows 10/11 | PowerShell and Python virtual environment | Documented from source; not verified on Windows in this documentation task |
| Linux | Native Python virtual environment | Existing Linux project layout inspected; fresh installation not verified in this task |
| macOS (Intel or Apple Silicon) | Terminal and Python virtual environment | Documented from source; not verified on macOS in this task |

Use Python **3.11 or newer** with `venv`, `pip`, and a working standard-library `sqlite3` module. The repository does not declare an exact maximum Python version; dependency compatibility depends on available wheels. Install packages from `requirements.txt`. A current browser is needed for the UI. Node.js and Playwright are not required to run the application.

`pillow-heif` is listed as a package dependency, but HEIF/HEIC support is optional at runtime: the application keeps other formats available if its native library cannot load. AVIF encoding and decoding likewise depend on installed Pillow codec support. Native image libraries and wheels can differ across operating systems and CPU architectures. Allow writable disk space for `JOB_DATA_DIR`, SQLite WAL files, queued uploads, ZIP results, and temporary multipart uploads.

## Installation

Work from an existing copy of this project. Preserve an existing `.env`, `data/`, and virtual environment when updating an installation. The commands below create `venv` only for a new installation.

### Linux

```bash
cd /path/to/image-toolkit
python3 --version
python3 -m venv venv
venv/bin/python -m pip install -r requirements.txt
venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 9781 --lifespan on --log-level info
```

Use a Python 3.11+ interpreter. Some distributions package `venv` separately; follow that distribution's instructions if environment creation fails.

### Windows 10/11 — PowerShell

```powershell
Set-Location (Read-Host "Enter the full path to the Image Toolkit project")
py --list
py -3.11 -m venv venv
& .\venv\Scripts\python.exe -m pip install -r requirements.txt
& .\venv\Scripts\python.exe -m uvicorn app.main:app --host 127.0.0.1 --port 9781 --lifespan on --log-level info
```

Select an installed supported interpreter if `py -3.11` is unavailable. Calling the virtual environment's `python.exe` directly does not require PowerShell activation. For optional login startup, see [Windows Auto-Start](docs/WINDOWS_AUTOSTART.md).

### macOS (Intel or Apple Silicon)

```bash
cd /path/to/image-toolkit
python3 --version
python3 -m venv venv
venv/bin/python -m pip install -r requirements.txt
venv/bin/python -m uvicorn app.main:app --host 127.0.0.1 --port 9781 --lifespan on --log-level info
```

Use Python 3.11+ for the machine's architecture. If a Pillow or HEIF wheel/native dependency is unavailable, resolve that platform-specific dependency before relying on the affected codec; this repository has no verified macOS codec matrix.

Open `http://127.0.0.1:9781/` on the same host. The documented port is an example from the previous project run command, not an application setting; choose another free port consistently if needed.

## Running the Application

From the project root, use `venv/bin/python` on Linux/macOS or `venv\Scripts\python.exe` on Windows.

| Mode | Uvicorn arguments after `-m uvicorn app.main:app` | Use |
| --- | --- | --- |
| Development | `--host 127.0.0.1 --port 9781 --reload` | Automatic reload while editing source |
| Local production | `--host 127.0.0.1 --port 9781 --lifespan on --log-level info` | Normal same-host use, no reload |

Run from the project root because `.env` and the default job data directory are relative to the working directory. Keep **one Uvicorn worker**: the queue and concurrency limits are process-local. To stop a foreground server, press Ctrl+C. Windows Task Scheduler startup is optional and documented separately. For optional remote access, configure a deliberate bind address, HTTPS, access policy, and request limits; a reverse proxy is not needed for localhost use.

## Configuration

Pydantic settings read environment variables and an optional `.env` in the working directory. The application starts without `.env`. [`.env.example`](.env.example) is a starting reference; do not overwrite an existing `.env`.

| Variable | Default | Meaning |
| --- | --- | --- |
| `APP_NAME` | `Image Toolkit` | FastAPI title |
| `MAX_UPLOAD_MB` | `20` | Maximum bytes per image read by the application |
| `MAX_IMAGE_PIXELS` | `40000000` | Input and resized output pixel limit |
| `MAX_BATCH_FILES` | `10` | Maximum image files per batch |
| `MAX_BATCH_TOTAL_MB` | `80` | Maximum total input bytes per batch |
| `MAX_OUTPUT_MB` | `80` | Result and ZIP size limit |
| `JOB_DATA_DIR` | `data/image-jobs` | Job directories and `jobs.sqlite3` location |
| `JOB_TTL_SECONDS` | `1800` | Result lifetime after a job ends |
| `JOB_CLEANUP_INTERVAL_SECONDS` | `60` | Background cleanup interval |
| `JOB_HISTORY_RETENTION_SECONDS` | `86400` | Additional metadata lifetime after result expiry |

The database path is `JOB_DATA_DIR/jobs.sqlite3`. Existing SQLite data and job files should be backed up and preserved during upgrades. Uvicorn host, port, and log level are command-line options, not app environment settings. Logs go to the foreground process's standard streams unless the operator redirects them; the Windows startup script writes per-run logs.

## Application Routes and API

FastAPI serves `/` (UI), `/static/*`, `/lang/*`, `/favicon.ico`, `/healthz`, and `/api/healthz`. The two health routes return `{"status":"ok"}`. `/docs`, `/redoc`, and `/openapi.json` are available through FastAPI's default documentation settings.

| Method and path | Request | Response |
| --- | --- | --- |
| `POST /api/inspect` | Multipart `file` | JSON format, width, height, mode, and input byte count |
| `POST /api/convert` | Multipart `file` plus optional form edits/logo | Downloadable image with content type, filename, byte-count headers, and `Cache-Control: no-store` |
| `POST /api/batch` | Multipart `files` plus shared form edits/logo | Downloadable ZIP |
| `POST /api/batch-edited` | Multipart `files`, per-image `settings_json`, optional logo | Downloadable ZIP |
| `POST /api/jobs` | Multipart `files`, per-image `settings_json`, optional logo | HTTP 202 JSON job snapshot and one-time `access_token` |
| `POST /api/jobs/history` | JSON `{"entries":[{"id":"...","token":"..."}]}` | JSON status entries for supplied credentials |
| `GET /api/jobs/{job_id}` | `X-Job-Token` header | JSON status snapshot |
| `POST /api/jobs/{job_id}/cancel` | `X-Job-Token` header | JSON status snapshot; cancellation occurs between images |
| `GET /api/jobs/{job_id}/download` | `X-Job-Token` header | ZIP while the completed result is available |

There is no separate manual cleanup API. Expired results are removed by scheduled cleanup and job operations; history removal in the browser only removes local browser records. Job IDs and tokens are bearer credentials. Only the token hash is stored in SQLite; the browser keeps its own token in localStorage.

## Privacy and File Processing

Image conversion runs in the **server's Pillow process**. The browser's visual editor is a preview. For `/api/inspect`, `/api/convert`, `/api/batch`, and `/api/batch-edited`, uploaded files are parsed by the server, read into memory for image processing, and are not saved as application job records. Multipart handling may use temporary files managed by the web stack. The response image or ZIP is assembled in memory.

`/api/jobs` stores each input under a unique directory in `JOB_DATA_DIR`; `run_job` deletes the input files after processing. Completed ZIPs remain at `JOB_DATA_DIR/<job_id>/result.zip` until the job TTL expires. SQLite stores job metadata and hashed access tokens. Cleanup removes expired result files, then retains terminal metadata for the configured additional history period. On restart, queued or running jobs are marked failed rather than resumed. The current source contains no image upload to a third-party processing service or remote URL input. Recent job credentials, locale, and theme are stored in browser localStorage; presets use user-managed JSON files.

## Limitations and Deployment Notes

- Input limits are enforced while reading parsed uploads; configure an upstream request-body limit if exposing the app beyond localhost.
- Decoded images, output buffers, and ZIP assembly can use much more memory than the compressed upload. Output size is checked after encoding/ZIP assembly.
- One image-processing slot is shared across immediate conversion and background jobs in one worker. Up to 12 queued/running jobs are accepted by the process-local job manager. Cancellation is cooperative between images; an in-progress image can finish first.
- HEIF/HEIC and AVIF availability varies with Pillow, `pillow-heif`, and native libraries. Unsupported animated inputs are rejected. Some codec save failures can surface as general processing errors.
- The browser's history pruning uses default retention constants; changing server TTL/history settings does not update that browser constant automatically.
- Result files expire; back up any wanted output promptly. Job history is local to a browser and is not a user account or durable queue.
- Native Windows and macOS installation and codec behavior have not been verified in this documentation task. Localhost needs no Nginx, systemd, Windows service, HTTPS certificate, or external database. Those are optional advanced deployment choices.

## Verification Status

The source contains the reported ERR-01 through ERR-03 fixes: shared off-loop image processing, explicit SQLite connection closure, and job-creation failure cleanup. The user reported completed manual browser verification in the task context; this documentation work did not independently repeat it. **Python and Playwright tests were not run in this task.** ERR-04 through ERR-06 were outside the required fix scope and remain as limitations above. These statements do not establish a cross-platform or codec compatibility guarantee.

## License

No `LICENSE` file or repository license policy was found in this project snapshot. Do not infer a license for this application or its dependencies; confirm licensing before redistribution.

## Further Reading

- [Windows Auto-Start](docs/WINDOWS_AUTOSTART.md)
- [Agent and contributor guidance](AGENTS.md)
