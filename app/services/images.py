from io import BytesIO
from pathlib import Path

from fastapi import HTTPException, UploadFile
from PIL import Image, ImageOps, ImageDraw, ImageFont, ImageEnhance, UnidentifiedImageError
HEIF_AVAILABLE = False
HEIF_ERROR = None
try:
    from pillow_heif import register_heif_opener
    register_heif_opener(thumbnails=False)
    HEIF_AVAILABLE = True
except (ImportError, OSError, RuntimeError) as exc:
    HEIF_ERROR = str(exc)

from app.config import settings

OUTPUTS = {"jpeg": "JPEG", "png": "PNG", "webp": "WEBP", "avif": "AVIF", "heic": "HEIF"}
INPUTS = {"JPEG", "PNG", "WEBP", "GIF", "BMP", "TIFF", "AVIF", "HEIF"}


async def load_image(file: UploadFile) -> tuple[Image.Image, int]:
    limit = settings.max_upload_mb * 1024 * 1024
    data = bytearray()
    while chunk := await file.read(1024 * 1024):
        if len(data) + len(chunk) > limit:
            raise HTTPException(413, "UPLOAD_LIMIT")
        data.extend(chunk)
    if not data:
        raise HTTPException(400, "EMPTY_FILE")
    try:
        with Image.open(BytesIO(data)) as source:
            if source.format not in INPUTS:
                raise HTTPException(415, "UNSUPPORTED_FORMAT")
            if source.width * source.height > settings.max_image_pixels:
                raise HTTPException(413, "PIXEL_LIMIT")
            if getattr(source, "is_animated", False) and getattr(source, "n_frames", 1) > 1:
                raise HTTPException(415, "ANIMATED_UNSUPPORTED")
            source.load()
            result = source.copy()
            result.info = dict(source.info)
            result.format = source.format
            return result, len(data)
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
        raise HTTPException(415, "INVALID_FILE") from exc


def process(image: Image.Image, output_format: str = "webp", width: int | None = None,
            height: int | None = None, quality: int = 85, rotate: int = 0,
            flip_horizontal: bool = False, flip_vertical: bool = False,
            crop_left: int | None = None, crop_top: int | None = None,
            crop_width: int | None = None, crop_height: int | None = None,
            watermark_text: str = "", watermark_opacity: int = 45,
            optimize: bool = True, watermark_position: str = "bottom-right",
            brightness: float = 1.0, contrast: float = 1.0,
            saturation: float = 1.0, sharpness: float = 1.0,
            watermark_image: bytes | None = None, watermark_scale: int = 20,
            crop_aspect: str = "free") -> bytes:
    if any(not 0 <= value <= 3 for value in (brightness, contrast, saturation, sharpness)):
        raise HTTPException(422, "ADJUSTMENT_INVALID")
    if not 1 <= watermark_scale <= 100:
        raise HTTPException(422, "WATERMARK_INVALID")
    if crop_aspect not in {"free", "1:1", "4:3", "16:9"}:
        raise HTTPException(422, "CROP_INVALID")
    if output_format not in OUTPUTS:
        raise HTTPException(422, "UNSUPPORTED_OUTPUT")
    if output_format == "heic" and not HEIF_AVAILABLE:
        raise HTTPException(415, "HEIC_UNAVAILABLE")
    image = ImageOps.exif_transpose(image)
    image.info.clear()
    crop = (crop_left, crop_top, crop_width, crop_height)
    if any(v is not None for v in crop):
        if any(v is None for v in crop):
            raise HTTPException(422, "CROP_INCOMPLETE")
        left, top, cw, ch = crop
        if left < 0 or top < 0 or cw <= 0 or ch <= 0 or left + cw > image.width or top + ch > image.height:
            raise HTTPException(422, "CROP_INVALID")
        image = image.crop((left, top, left + cw, top + ch))
    if rotate:
        image = image.rotate(-rotate, expand=True)
    if flip_horizontal:
        image = ImageOps.mirror(image)
    if flip_vertical:
        image = ImageOps.flip(image)
    if width or height:
        tw = width or max(1, round(image.width * height / image.height))
        th = height or max(1, round(image.height * width / image.width))
        if tw * th > settings.max_image_pixels:
            raise HTTPException(413, "OUTPUT_PIXEL_LIMIT")
        image = image.resize((tw, th), Image.Resampling.LANCZOS)
    image = ImageEnhance.Brightness(image).enhance(brightness)
    image = ImageEnhance.Contrast(image).enhance(contrast)
    image = ImageEnhance.Color(image).enhance(saturation)
    image = ImageEnhance.Sharpness(image).enhance(sharpness)
    if watermark_image:
        if len(watermark_image) > 5 * 1024 * 1024:
            raise HTTPException(413, "UPLOAD_LIMIT")
        try:
            with Image.open(BytesIO(watermark_image)) as logo_source:
                if logo_source.format != "PNG" or logo_source.width * logo_source.height > 4000000:
                    raise HTTPException(415, "WATERMARK_INVALID")
                logo_source.load()
                logo = logo_source.convert("RGBA")
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError) as exc:
            raise HTTPException(415, "WATERMARK_INVALID") from exc
        if watermark_position not in {"top-left", "top-right", "center", "bottom-left", "bottom-right"}:
            raise HTTPException(422, "WATERMARK_INVALID")
        target_width = max(1, round(image.width * watermark_scale / 100))
        target_height = max(1, round(logo.height * target_width / logo.width))
        if target_height > image.height:
            target_height = image.height
            target_width = max(1, round(logo.width * target_height / logo.height))
        logo = logo.resize((target_width, target_height), Image.Resampling.LANCZOS)
        logo.putalpha(logo.getchannel("A").point(lambda value: round(value * watermark_opacity / 100)))
        base = image.convert("RGBA")
        margin = max(4, min(base.size) // 40)
        positions = {"top-left": (margin, margin), "top-right": (base.width - logo.width - margin, margin), "center": ((base.width - logo.width) // 2, (base.height - logo.height) // 2), "bottom-left": (margin, base.height - logo.height - margin), "bottom-right": (base.width - logo.width - margin, base.height - logo.height - margin)}
        base.alpha_composite(logo, tuple(max(0, value) for value in positions[watermark_position]))
        image = base
    if watermark_text:
        if len(watermark_text) > 120 or not 1 <= watermark_opacity <= 100 or watermark_position not in {"top-left", "top-right", "center", "bottom-left", "bottom-right"}:
            raise HTTPException(422, "WATERMARK_INVALID")
        base = image.convert("RGBA")
        layer = Image.new("RGBA", base.size, (0, 0, 0, 0))
        draw = ImageDraw.Draw(layer)
        font = ImageFont.load_default(size=max(12, min(72, image.width // 24)))
        box = draw.textbbox((0, 0), watermark_text, font=font)
        tw, th = box[2] - box[0], box[3] - box[1]
        margin = max(8, min(base.size) // 40)
        positions = {"top-left": (margin, margin), "top-right": (base.width - tw - margin, margin), "center": ((base.width - tw) // 2, (base.height - th) // 2), "bottom-left": (margin, base.height - th - margin), "bottom-right": (base.width - tw - margin, base.height - th - margin)}
        px, py = positions[watermark_position]
        draw.text((max(0, px), max(0, py)),
                  watermark_text, font=font, fill=(255, 255, 255, round(watermark_opacity * 255 / 100)),
                  stroke_width=1, stroke_fill=(0, 0, 0, round(watermark_opacity * 255 / 100)))
        image = Image.alpha_composite(base, layer)
    if output_format == "jpeg":
        rgba = image.convert("RGBA")
        background = Image.new("RGB", rgba.size, "white")
        background.paste(rgba, mask=rgba.getchannel("A"))
        image = background
    elif image.mode not in ("RGB", "RGBA", "L", "LA"):
        image = image.convert("RGBA")
    buffer = BytesIO()
    if output_format == "heic" and image.mode not in ("RGB", "RGBA"):
        image = image.convert("RGBA")
    if output_format in ("jpeg", "webp", "avif", "heic"):
        opts = {"quality": quality}
        if output_format == "jpeg":
            opts.update(optimize=optimize, progressive=optimize)
        elif output_format == "webp":
            opts["method"] = 6 if optimize else 4
    else:
        opts = {"optimize": optimize}
    image.save(buffer, format=OUTPUTS[output_format], **opts)
    if buffer.tell() > settings.max_output_mb * 1024 * 1024:
        raise HTTPException(413, "OUTPUT_SIZE_LIMIT")
    return buffer.getvalue()


def safe_stem(name: str | None) -> str:
    stem = Path((name or "image").replace("\\", "/").split("/")[-1]).stem
    cleaned = "".join(c if c.isascii() and (c.isalnum() or c in "-_") else "_" for c in stem)
    return cleaned[:60].strip("._") or "image"
