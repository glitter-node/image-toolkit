import asyncio
from contextlib import asynccontextmanager
from pathlib import Path

from fastapi import FastAPI
from fastapi.responses import FileResponse, HTMLResponse
from fastapi.staticfiles import StaticFiles

from app.security import SecurityHeadersMiddleware
from app.config import settings
from app.routers.api import router
from app.routers.jobs import router as jobs_router

from app.services.jobs import clean_expired, recover_jobs


@asynccontextmanager
async def lifespan(application):
    recover_jobs()
    async def maintenance():
        while True:
            await asyncio.sleep(settings.job_cleanup_interval_seconds)
            await asyncio.to_thread(clean_expired)
    task = asyncio.create_task(maintenance())
    try:
        yield
    finally:
        task.cancel()
        try:
            await task
        except asyncio.CancelledError:
            pass


BASE = Path(__file__).resolve().parent
app = FastAPI(title=settings.app_name, version="0.1.0", lifespan=lifespan)
app.add_middleware(SecurityHeadersMiddleware)
app.include_router(router)
app.include_router(jobs_router)
app.mount("/static", StaticFiles(directory=BASE / "static"), name="static")
app.mount("/lang", StaticFiles(directory=BASE / "lang"), name="lang")


@app.get("/", response_class=HTMLResponse, include_in_schema=False)
async def index():
    return HTMLResponse((BASE / "templates" / "index.html").read_text(encoding="utf-8").replace("{{APP_VERSION}}", app.version), headers={"Cache-Control": "no-store"})


@app.get("/favicon.ico", include_in_schema=False)
async def favicon():
    return FileResponse(BASE / "static" / "favicon.ico", media_type="image/x-icon")


@app.get("/robots.txt", include_in_schema=False)
async def robots():
    return FileResponse(BASE / "static" / "robots.txt", media_type="text/plain", headers={"Content-Type": "text/plain; charset=utf-8"})


@app.get("/sitemap.xml", include_in_schema=False)
async def sitemap():
    return FileResponse(BASE / "static" / "sitemap.xml", media_type="application/xml", headers={"Content-Type": "application/xml; charset=utf-8"})


@app.get("/healthz")
async def healthz():
    return {"status": "ok"}
