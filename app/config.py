from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Image Toolkit"
    max_upload_mb: int = 20
    max_image_pixels: int = 40_000_000
    max_batch_files: int = 10
    max_batch_total_mb: int = 80
    max_output_mb: int = 80
    job_data_dir: str = "data/image-jobs"
    job_ttl_seconds: int = 1800
    job_cleanup_interval_seconds: int = 60
    job_history_retention_seconds: int = 86400
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")


settings = Settings()
