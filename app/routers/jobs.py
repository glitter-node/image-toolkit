from json import loads

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, Header
from fastapi.responses import FileResponse
from pydantic import ValidationError, BaseModel, Field

from app.routers.api import ImageEdits
from app.services.jobs import cancel_job, create_job, authorize_job, snapshot, history_entries

router = APIRouter(prefix="/api/jobs", tags=["jobs"])


@router.post("", status_code=202)
async def submit(files: list[UploadFile] = File(...), settings_json: str = Form(...), watermark_logo: UploadFile | None = File(None)):
    if len(settings_json) > 65536:
        raise HTTPException(422, "INVALID_SETTINGS")
    try:
        raw = loads(settings_json)
        if not isinstance(raw, list) or len(raw) != len(files):
            raise ValueError("Invalid settings count")
        edits = [ImageEdits.model_validate(item) for item in raw]
    except (ValueError, TypeError, ValidationError):
        raise HTTPException(422, "INVALID_SETTINGS")
    return await create_job(files, edits, watermark_logo)


class HistoryCredential(BaseModel):
    id: str
    token: str


class HistoryRequest(BaseModel):
    entries: list[HistoryCredential] = Field(max_length=20)


@router.post("/history")
async def history(request: HistoryRequest):
    return history_entries([item.model_dump() for item in request.entries])


@router.get("/{job_id}")
async def status(job_id: str, x_job_token: str | None = Header(None)):
    return snapshot(authorize_job(job_id, x_job_token))


@router.post("/{job_id}/cancel")
async def cancel(job_id: str, x_job_token: str | None = Header(None)):
    authorize_job(job_id, x_job_token)
    return cancel_job(job_id)


@router.get("/{job_id}/download")
async def download(job_id: str, x_job_token: str | None = Header(None)):
    job = authorize_job(job_id, x_job_token)
    if job["state"] != "completed":
        raise HTTPException(409, "JOB_NOT_READY")
    from app.services.jobs import DATA_DIR
    archive = DATA_DIR / job_id / "result.zip"
    if not archive.is_file():
        raise HTTPException(410, "RESULT_EXPIRED")
    return FileResponse(archive, media_type="application/zip", filename="image-toolkit-batch.zip", headers={"Cache-Control": "no-store", "X-Content-Type-Options": "nosniff"})
