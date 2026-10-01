from typing import Annotated

from fastapi import APIRouter, Depends, Response

from app.core.config import get_settings
from app.core.rate_limit import rate_limit
from app.core.security import CurrentUserDep, get_access_token
from app.schemas.auth import LoginRequest, LoginResponse, PasswordChangeRequest, PasswordResetRequest
from app.services import auth_service

router = APIRouter(prefix="/auth", tags=["auth"])

login_limit = rate_limit(
    "login", lambda: get_settings().login_rate_limit, lambda: get_settings().login_rate_window_seconds
)
reset_limit = rate_limit(
    "reset", lambda: get_settings().reset_rate_limit, lambda: get_settings().reset_rate_window_seconds
)


@router.post("/login", response_model=LoginResponse, dependencies=[Depends(login_limit)])
def login(body: LoginRequest) -> dict:
    return auth_service.login(body.email, body.password)


@router.post("/logout", status_code=204)
def logout(user: CurrentUserDep, token: Annotated[str, Depends(get_access_token)]) -> Response:
    auth_service.logout(token, user)
    return Response(status_code=204)


@router.post("/password/change", status_code=204)
def change_password(body: PasswordChangeRequest, user: CurrentUserDep) -> Response:
    auth_service.change_password(user, body.current_password, body.new_password)
    return Response(status_code=204)


@router.post("/password/reset", status_code=202, dependencies=[Depends(reset_limit)])
def reset_password(body: PasswordResetRequest) -> dict:
    auth_service.request_password_reset(body.email)
    return {"message": "If an account exists for that email, a reset link has been sent."}
