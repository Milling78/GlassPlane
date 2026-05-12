from pydantic_settings import BaseSettings, SettingsConfigDict
from functools import lru_cache


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # vCenter
    vcenter_host: str = ""
    vcenter_user: str = ""
    vcenter_password: str = ""
    vcenter_port: int = 443
    vcenter_ssl_verify: bool = False

    # Aruba Central
    aruba_central_base_url: str = "https://apigw-prod2.central.arubanetworks.com"
    aruba_client_id: str = ""
    aruba_client_secret: str = ""
    aruba_customer_id: str = ""
    aruba_access_token: str = ""

    # Alletra 6000
    alletra_host: str = ""
    alletra_user: str = ""
    alletra_password: str = ""
    alletra_port: int = 8080

    # Veeam
    veeam_host: str = ""
    veeam_user: str = ""
    veeam_password: str = ""
    veeam_port: int = 9419

    # App
    cache_ttl_seconds: int = 60
    log_level: str = "INFO"
    api_key: str = ""
    allowed_origins: str = "*"


@lru_cache
def get_settings() -> Settings:
    return Settings()
