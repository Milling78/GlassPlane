from fastapi import APIRouter, HTTPException, Security
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from config import get_settings

auth_router = APIRouter(prefix="/auth", tags=["Auth"])
_bearer = HTTPBearer(auto_error=False)


@auth_router.post("/verify")
async def verify(
    credentials: HTTPAuthorizationCredentials | None = Security(_bearer),
):
    settings = get_settings()
    if not settings.api_key:
        return {"authenticated": True, "auth_enabled": False}
    if not credentials or credentials.credentials != settings.api_key:
        raise HTTPException(status_code=401, detail="Invalid API key")
    return {"authenticated": True, "auth_enabled": True}
