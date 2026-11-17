import asyncio
from io import BytesIO
from zipfile import ZIP_DEFLATED, ZipFile

from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import Response
from starlette.concurrency import run_in_threadpool

from app.config import settings
from app.services.images import load_image, process, safe_stem

router = APIRouter(prefix="/api", tags=["images"])
PROCESS_SLOTS = asyncio.Semaphore(1)


async def process_image(*args):
    async with PROCESS_SLOTS:
        return await run_in_threadpool(process, *args)


@router.get("/healthz")
async def healthz():
    return {"status": "ok"}


@router.post("/inspect")
async def inspect(file: UploadFile = File(...)):
    image, size = await load_image(file)
    return {"format": image.format, "width": image.width, "height": image.height,
            "mode": image.mode, "bytes": size}


@router.post("/convert")
async def convert(
    file: UploadFile = File(...),
    output_format: str = Form("webp", pattern="^(jpeg|png|webp|avif|heic)$"),
    width: int | None = Form(None, ge=1, le=20000),
    height: int | None = Form(None, ge=1, le=20000),
    quality: int = Form(85, ge=1, le=100),
    rotate: int = Form(0, ge=0, le=270, multiple_of=90),
    flip_horizontal: bool = Form(False),
    flip_vertical: bool = Form(False),
    crop_left: int | None = Form(None, ge=0),
    crop_top: int | None = Form(None, ge=0),
    crop_width: int | None = Form(None, ge=1),
    crop_height: int | None = Form(None, ge=1),
    watermark_text: str = Form("", max_length=120),
    watermark_opacity: int = Form(45, ge=1, le=100),
    optimize: bool = Form(True),
    watermark_position: str = Form("bottom-right", pattern="^(top-left|top-right|center|bottom-left|bottom-right)$"),
    brightness: float = Form(1.0, ge=0, le=3),
    contrast: float = Form(1.0, ge=0, le=3),
    saturation: float = Form(1.0, ge=0, le=3),
    sharpness: float = Form(1.0, ge=0, le=3),
    watermark_logo: UploadFile | None = File(None),
    watermark_scale: int = Form(20, ge=1, le=100),
    crop_aspect: str = Form("free", pattern="^(free|1:1|4:3|16:9)$"),
):
    image, original_size = await load_image(file)
    logo = await watermark_logo.read(5 * 1024 * 1024 + 1) if watermark_logo else None
    result = await process_image(image, output_format, width, height, quality, rotate, flip_horizontal,
                     flip_vertical, crop_left, crop_top, crop_width, crop_height,
                     watermark_text, watermark_opacity, optimize, watermark_position, brightness, contrast, saturation, sharpness, logo, watermark_scale, crop_aspect)
    ext = "jpg" if output_format == "jpeg" else output_format
    return Response(result, media_type={"heic": "image/heic", "jpeg": "image/jpeg"}.get(output_format, f"image/{output_format}"), headers={
        "Content-Disposition": f'attachment; filename="{safe_stem(file.filename)}.{ext}"',
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "X-Original-Bytes": str(original_size), "X-Output-Bytes": str(len(result)),
    })


@router.post("/batch")
async def batch(
    files: list[UploadFile] = File(...),
    output_format: str = Form("webp", pattern="^(jpeg|png|webp|avif|heic)$"),
    width: int | None = Form(None, ge=1, le=20000),
    height: int | None = Form(None, ge=1, le=20000),
    quality: int = Form(85, ge=1, le=100),
    rotate: int = Form(0, ge=0, le=270, multiple_of=90),
    flip_horizontal: bool = Form(False),
    flip_vertical: bool = Form(False),
    crop_left: int | None = Form(None, ge=0),
    crop_top: int | None = Form(None, ge=0),
    crop_width: int | None = Form(None, ge=1),
    crop_height: int | None = Form(None, ge=1),
    watermark_text: str = Form("", max_length=120),
    watermark_opacity: int = Form(45, ge=1, le=100),
    optimize: bool = Form(True),
    watermark_position: str = Form("bottom-right", pattern="^(top-left|top-right|center|bottom-left|bottom-right)$"),
    brightness: float = Form(1.0, ge=0, le=3),
    contrast: float = Form(1.0, ge=0, le=3),
    saturation: float = Form(1.0, ge=0, le=3),
    sharpness: float = Form(1.0, ge=0, le=3),
    watermark_logo: UploadFile | None = File(None),
    watermark_scale: int = Form(20, ge=1, le=100),
    crop_aspect: str = Form("free", pattern="^(free|1:1|4:3|16:9)$"),
):
    if not files or len(files) > settings.max_batch_files:
        raise HTTPException(413, "BATCH_COUNT_LIMIT")
    logo = await watermark_logo.read(5 * 1024 * 1024 + 1) if watermark_logo else None
    archive = BytesIO()
    total_input = 0
    total_output = 0
    used = set()
    ext = "jpg" if output_format == "jpeg" else output_format
    with ZipFile(archive, "w", compression=ZIP_DEFLATED) as zip_file:
        for file in files:
            image, size = await load_image(file)
            total_input += size
            if total_input > settings.max_batch_total_mb * 1024 * 1024:
                raise HTTPException(413, "BATCH_SIZE_LIMIT")
            result = await process_image(image, output_format, width, height, quality, rotate,
                             flip_horizontal, flip_vertical, crop_left, crop_top, crop_width, crop_height,
                     watermark_text, watermark_opacity, optimize, watermark_position, brightness, contrast, saturation, sharpness, logo, watermark_scale, crop_aspect)
            total_output += len(result)
            if total_output > settings.max_output_mb * 1024 * 1024:
                raise HTTPException(413, "OUTPUT_SIZE_LIMIT")
            stem = safe_stem(file.filename)
            name = f"{stem}.{ext}"
            index = 2
            while name in used:
                name = f"{stem}_{index}.{ext}"
                index += 1
            used.add(name)
            zip_file.writestr(name, result)
    if archive.tell() > settings.max_output_mb * 1024 * 1024:
        raise HTTPException(413, "OUTPUT_SIZE_LIMIT")
    return Response(archive.getvalue(), media_type="application/zip", headers={
        "Content-Disposition": 'attachment; filename="image-toolkit-batch.zip"',
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "X-Original-Bytes": str(total_input), "X-Output-Bytes": str(total_output),
    })


from json import JSONDecodeError, loads
from pydantic import BaseModel, ConfigDict, Field, ValidationError


class ImageEdits(BaseModel):
    model_config = ConfigDict(extra="forbid", strict=True)
    output_format: str = Field(pattern=r"^(jpeg|png|webp|avif|heic)$")
    width: int | None = Field(default=None, ge=1, le=20000)
    height: int | None = Field(default=None, ge=1, le=20000)
    quality: int = Field(default=85, ge=1, le=100)
    rotate: int = Field(default=0, ge=0, le=270, multiple_of=90)
    flip_horizontal: bool = False
    flip_vertical: bool = False
    crop_left: int | None = Field(default=None, ge=0)
    crop_top: int | None = Field(default=None, ge=0)
    crop_width: int | None = Field(default=None, ge=1)
    crop_height: int | None = Field(default=None, ge=1)
    watermark_text: str = Field(default="", max_length=120)
    watermark_opacity: int = Field(default=45, ge=1, le=100)
    optimize: bool = True
    watermark_position: str = Field(default="bottom-right", pattern=r"^(top-left|top-right|center|bottom-left|bottom-right)$")
    brightness: float = Field(default=1.0, ge=0, le=3)
    contrast: float = Field(default=1.0, ge=0, le=3)
    saturation: float = Field(default=1.0, ge=0, le=3)
    sharpness: float = Field(default=1.0, ge=0, le=3)
    watermark_scale: int = Field(default=20, ge=1, le=100)
    crop_aspect: str = Field(default="free", pattern=r"^(free|1:1|4:3|16:9)$")


@router.post("/batch-edited")
async def batch_edited(files: list[UploadFile] = File(...), settings_json: str = Form(...), watermark_logo: UploadFile | None = File(None)):
    if not files or len(files) > settings.max_batch_files:
        raise HTTPException(413, "BATCH_COUNT_LIMIT")
    if len(settings_json) > 65536:
        raise HTTPException(422, "INVALID_SETTINGS")
    try:
        raw = loads(settings_json)
        if not isinstance(raw, list) or len(raw) != len(files):
            raise ValueError("Invalid settings count")
        edits = [ImageEdits.model_validate(item) for item in raw]
    except (ValueError, TypeError, JSONDecodeError, ValidationError):
        raise HTTPException(422, "INVALID_SETTINGS")
    logo = await watermark_logo.read(5 * 1024 * 1024 + 1) if watermark_logo else None
    if logo and len(logo) > 5 * 1024 * 1024:
        raise HTTPException(413, "UPLOAD_LIMIT")
    archive = BytesIO()
    total_input = total_output = 0
    used = set()
    with ZipFile(archive, "w", compression=ZIP_DEFLATED) as zip_file:
        for file, edit in zip(files, edits):
            image, size = await load_image(file)
            total_input += size
            if total_input > settings.max_batch_total_mb * 1024 * 1024:
                raise HTTPException(413, "BATCH_SIZE_LIMIT")
            result = await process_image(image, edit.output_format, edit.width, edit.height, edit.quality,
                             edit.rotate, edit.flip_horizontal, edit.flip_vertical,
                             edit.crop_left, edit.crop_top, edit.crop_width, edit.crop_height,
                             edit.watermark_text, edit.watermark_opacity, edit.optimize,
                             edit.watermark_position, edit.brightness, edit.contrast,
                             edit.saturation, edit.sharpness, logo, edit.watermark_scale, edit.crop_aspect)
            total_output += len(result)
            if total_output > settings.max_output_mb * 1024 * 1024:
                raise HTTPException(413, "OUTPUT_SIZE_LIMIT")
            ext = "jpg" if edit.output_format == "jpeg" else edit.output_format
            stem = safe_stem(file.filename)
            name = f"{stem}.{ext}"
            index = 2
            while name in used:
                name = f"{stem}_{index}.{ext}"
                index += 1
            used.add(name)
            zip_file.writestr(name, result)
    if archive.tell() > settings.max_output_mb * 1024 * 1024:
        raise HTTPException(413, "OUTPUT_SIZE_LIMIT")
    return Response(archive.getvalue(), media_type="application/zip", headers={
        "Content-Disposition": 'attachment; filename="image-toolkit-batch.zip"',
        "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff",
        "X-Original-Bytes": str(total_input), "X-Output-Bytes": str(total_output),
    })
