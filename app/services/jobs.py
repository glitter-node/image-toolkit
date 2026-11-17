import asyncio
import json
import hashlib
import secrets
import sqlite3
import threading
import shutil
import time
import uuid
from contextlib import contextmanager
from pathlib import Path
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import HTTPException, UploadFile

from app.config import settings
from app.routers.api import ImageEdits, process_image
from app.services.images import load_image, safe_stem

JOBS = {}
MAX_JOBS = 12
HISTORY_RETENTION_SECONDS = settings.job_history_retention_seconds
TTL_SECONDS = settings.job_ttl_seconds
DATA_DIR = Path(settings.job_data_dir).resolve()
DB_FILE = DATA_DIR / "jobs.sqlite3"
DB_LOCK = threading.RLock()
SLOTS = asyncio.Semaphore(1)


@contextmanager
def database():
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(DB_FILE, timeout=10)
    try:
        connection.execute("PRAGMA journal_mode=WAL")
        connection.execute("CREATE TABLE IF NOT EXISTS jobs (id TEXT PRIMARY KEY, state TEXT NOT NULL, completed INTEGER NOT NULL, total INTEGER NOT NULL, percent INTEGER NOT NULL, current TEXT NOT NULL, error TEXT, details TEXT NOT NULL, updated REAL NOT NULL)")
        columns = {row[1] for row in connection.execute("PRAGMA table_info(jobs)")}
        if "token_hash" not in columns:
            connection.execute("ALTER TABLE jobs ADD COLUMN token_hash TEXT NOT NULL DEFAULT ''")
        if "expires_at" not in columns:
            connection.execute("ALTER TABLE jobs ADD COLUMN expires_at REAL")
            connection.execute("UPDATE jobs SET expires_at = updated + ? WHERE expires_at IS NULL AND state IN ('completed','cancelled','failed')", (TTL_SECONDS,))
        with connection:
            yield connection
    finally:
        connection.close()


def persist(job):
    details = json.dumps(job.get("details", []), ensure_ascii=False)
    if job.get("expires_at") is None and job["state"] in ("completed", "cancelled", "failed"):
        job["expires_at"] = time.time() + TTL_SECONDS
    with DB_LOCK, database() as connection:
        connection.execute("INSERT INTO jobs (id,state,completed,total,percent,current,error,details,updated,token_hash,expires_at) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET state=excluded.state,completed=excluded.completed,total=excluded.total,percent=excluded.percent,current=excluded.current,error=excluded.error,details=excluded.details,updated=excluded.updated,expires_at=excluded.expires_at",
            (job["id"], job["state"], job["completed"], job["total"], job["percent"], job["current"], job["error"], details, time.time(), job.get("token_hash", ""), job.get("expires_at")))


def saved_job(job_id):
    with DB_LOCK, database() as connection:
        row = connection.execute("SELECT id,state,completed,total,percent,current,error,details,expires_at FROM jobs WHERE id=?", (job_id,)).fetchone()
    if row is None:
        return None
    return dict(zip(("id", "state", "completed", "total", "percent", "current", "error", "details", "expires_at"),
        (*row[:7], json.loads(row[7]), row[8])))


def recover_jobs():
    with DB_LOCK, database() as connection:
        rows = connection.execute("SELECT id, details FROM jobs WHERE state IN ('queued','running')").fetchall()
        for job_id, raw_details in rows:
            details = json.loads(raw_details)
            for item in details:
                if item["state"] in ("queued", "running"):
                    item["state"] = "failed"
                    item["error"] = "SERVER_RESTARTED"
            connection.execute("UPDATE jobs SET state='failed', error='SERVER_RESTARTED', details=?, updated=?, expires_at=? WHERE id=?",
                (json.dumps(details, ensure_ascii=False), time.time(), time.time() + TTL_SECONDS, job_id))
    clean_expired()


def clean_expired():
    now = time.time()
    with DB_LOCK, database() as connection:
        expired = connection.execute("SELECT id FROM jobs WHERE state IN ('completed','cancelled','failed') AND expires_at IS NOT NULL AND expires_at <= ?", (now,)).fetchall()
        for (job_id,) in expired:
            shutil.rmtree(DATA_DIR / job_id, ignore_errors=True)
            JOBS.pop(job_id, None)
        connection.execute("DELETE FROM jobs WHERE state IN ('completed','cancelled','failed') AND expires_at IS NOT NULL AND expires_at <= ?", (now - HISTORY_RETENTION_SECONDS,))
        known = {row[0] for row in connection.execute("SELECT id FROM jobs")}
    for directory in DATA_DIR.iterdir():
        if directory.is_dir() and directory.name not in known and directory.name not in JOBS:
            if now - directory.stat().st_mtime > TTL_SECONDS:
                shutil.rmtree(directory, ignore_errors=True)


def history_entries(credentials):
    if not isinstance(credentials, list) or len(credentials) > 20:
        raise HTTPException(422, "INVALID_HISTORY")
    now = time.time()
    result = []
    with DB_LOCK, database() as connection:
        for item in credentials:
            if not isinstance(item, dict):
                raise HTTPException(422, "INVALID_HISTORY")
            job_id, token = item.get("id"), item.get("token")
            if not isinstance(job_id, str) or len(job_id) != 32 or any(c not in "0123456789abcdef" for c in job_id):
                raise HTTPException(422, "INVALID_HISTORY")
            if not isinstance(token, str) or not 20 < len(token) <= 256:
                raise HTTPException(422, "INVALID_HISTORY")
            row = connection.execute("SELECT token_hash,expires_at FROM jobs WHERE id=?", (job_id,)).fetchone()
            supplied = hashlib.sha256(token.encode()).hexdigest()
            if not row or not row[0] or not secrets.compare_digest(row[0], supplied):
                result.append({"id": job_id, "kind": "unavailable"})
                continue
            if row[1] is not None and row[1] <= now:
                result.append({"id": job_id, "kind": "expired", "expires_at": row[1]})
                continue
            job = JOBS.get(job_id) or saved_job(job_id)
            if job:
                result.append({"id": job_id, "kind": "job", "job": snapshot(job)})
            else:
                result.append({"id": job_id, "kind": "unavailable"})
    return {"entries": result, "server_time": now, "history_retention_seconds": HISTORY_RETENTION_SECONDS}


def snapshot(job):
    result = {key: job[key] for key in ("id", "state", "completed", "total", "percent", "current", "error", "details")}
    result["expires_at"] = job.get("expires_at")
    return result


async def create_job(files: list[UploadFile], edits: list[ImageEdits], logo: UploadFile | None):
    clean_expired()
    if sum(job["state"] in ("queued", "running") for job in JOBS.values()) >= MAX_JOBS:
        raise HTTPException(429, "JOB_LIMIT")
    if not files or len(files) > settings.max_batch_files:
        raise HTTPException(413, "BATCH_COUNT_LIMIT")
    job_id = uuid.uuid4().hex
    directory = DATA_DIR / job_id
    directory.mkdir(parents=True, exist_ok=False)
    entries = []
    total = 0
    try:
        for index, file in enumerate(files):
            path = directory / f"input-{index}"
            count = 0
            with path.open("wb") as output:
                while chunk := await file.read(1024 * 1024):
                    count += len(chunk)
                    total += len(chunk)
                    if count > settings.max_upload_mb * 1024 * 1024:
                        raise HTTPException(413, "UPLOAD_LIMIT")
                    if total > settings.max_batch_total_mb * 1024 * 1024:
                        raise HTTPException(413, "BATCH_SIZE_LIMIT")
                    output.write(chunk)
            if not count:
                raise HTTPException(400, "EMPTY_FILE")
            entries.append((path, safe_stem(file.filename), edits[index]))
        logo_bytes = await logo.read(5 * 1024 * 1024 + 1) if logo else None
        if logo_bytes and len(logo_bytes) > 5 * 1024 * 1024:
            raise HTTPException(413, "UPLOAD_LIMIT")
    except BaseException:
        shutil.rmtree(directory, ignore_errors=True)
        raise
    try:
        access_token = secrets.token_urlsafe(32)
        job = {"id": job_id, "token_hash": hashlib.sha256(access_token.encode()).hexdigest(), "directory": directory, "entries": entries, "logo": logo_bytes,
               "state": "queued", "completed": 0, "total": len(entries), "percent": 0,
               "current": "", "error": None, "details": [{"name": stem, "state": "queued", "error": None} for _, stem, _ in entries], "cancel": False, "updated": time.monotonic(), "expires_at": None, "task": None}
        JOBS[job_id] = job
        persist(job)
        job["task"] = asyncio.create_task(run_job(job))
        return {**snapshot(job), "access_token": access_token}
    except BaseException:
        JOBS.pop(job_id, None)
        try:
            with DB_LOCK, database() as connection:
                connection.execute("DELETE FROM jobs WHERE id=?", (job_id,))
        except Exception:
            pass
        shutil.rmtree(directory, ignore_errors=True)
        raise


async def run_job(job):
    try:
        async with SLOTS:
            if job["cancel"]:
                job["state"] = "cancelled"
                persist(job)
                return
            job["state"] = "running"
            persist(job)
            archive = job["directory"] / "result.zip"
            used = set()
            output_total = 0
            with ZipFile(archive, "w", ZIP_DEFLATED) as zip_file:
                for index, (path, stem, edit) in enumerate(job["entries"]):
                    if job["cancel"]:
                        job["state"] = "cancelled"
                        return
                    job["current"] = stem
                    job["details"][index]["state"] = "running"
                    persist(job)
                    job["updated"] = time.monotonic()
                    with path.open("rb") as stream:
                        upload = UploadFile(file=stream, filename=stem)
                        image, _ = await load_image(upload)
                    result = await process_image(image, edit.output_format, edit.width,
                        edit.height, edit.quality, edit.rotate, edit.flip_horizontal, edit.flip_vertical,
                        edit.crop_left, edit.crop_top, edit.crop_width, edit.crop_height,
                        edit.watermark_text, edit.watermark_opacity, edit.optimize,
                        edit.watermark_position, edit.brightness, edit.contrast,
                        edit.saturation, edit.sharpness, job["logo"], edit.watermark_scale, edit.crop_aspect)
                    if job["cancel"]:
                        job["state"] = "cancelled"
                        return
                    output_total += len(result)
                    if output_total > settings.max_output_mb * 1024 * 1024:
                        raise HTTPException(413, "OUTPUT_SIZE_LIMIT")
                    ext = "jpg" if edit.output_format == "jpeg" else edit.output_format
                    name = f"{stem}.{ext}"
                    suffix = 2
                    while name in used:
                        name = f"{stem}_{suffix}.{ext}"
                        suffix += 1
                    used.add(name)
                    zip_file.writestr(name, result)
                    job["details"][index]["state"] = "completed"
                    job["completed"] += 1
                    job["percent"] = round(job["completed"] / job["total"] * 100)
                    job["updated"] = time.monotonic()
                    persist(job)
                    await asyncio.sleep(0)
            if archive.stat().st_size > settings.max_output_mb * 1024 * 1024:
                raise HTTPException(413, "OUTPUT_SIZE_LIMIT")
            job["state"] = "cancelled" if job["cancel"] else "completed"
    except Exception as exc:
        job["state"] = "failed"
        job["error"] = exc.detail if isinstance(exc, HTTPException) else "PROCESSING_FAILED"
    finally:
        if job["state"] == "cancelled":
            for detail in job["details"]:
                if detail["state"] in ("queued", "running"):
                    detail["state"] = "cancelled"
        if job["state"] == "failed":
            for detail in job["details"]:
                if detail["state"] == "running":
                    detail["state"] = "failed"
                    detail["error"] = job["error"]
        job["updated"] = time.monotonic()
        job["expires_at"] = time.time() + TTL_SECONDS
        persist(job)
        for path, _, _ in job["entries"]:
            path.unlink(missing_ok=True)
        if job["state"] != "completed":
            (job["directory"] / "result.zip").unlink(missing_ok=True)


def get_job(job_id):
    clean_expired()
    job = JOBS.get(job_id) or saved_job(job_id)
    if not job:
        raise HTTPException(404, "JOB_NOT_FOUND")
    if job.get("expires_at") is not None and job["expires_at"] <= time.time():
        raise HTTPException(410, "RESULT_EXPIRED")
    return job


def cancel_job(job_id):
    job = get_job(job_id)
    if job["state"] in ("queued", "running") and job_id in JOBS:
        job["cancel"] = True
        persist(job)
    return snapshot(job)


def authorize_job(job_id, token):
    if not token or len(token) > 256:
        raise HTTPException(403, "JOB_ACCESS_DENIED")
    job = get_job(job_id)
    with DB_LOCK, database() as connection:
        row = connection.execute("SELECT token_hash FROM jobs WHERE id=?", (job_id,)).fetchone()
    expected = row[0] if row else ""
    supplied = hashlib.sha256(token.encode()).hexdigest()
    if not expected or not secrets.compare_digest(expected, supplied):
        raise HTTPException(403, "JOB_ACCESS_DENIED")
    return job
