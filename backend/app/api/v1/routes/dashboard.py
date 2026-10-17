from datetime import date
from typing import Annotated

from fastapi import APIRouter, Query

from app.core.security import CurrentUserDep
from app.schemas.dashboard import DashboardOut
from app.schemas.timetable import TimetableOut
from app.services import dashboard_service, timetable_service

router = APIRouter(tags=["dashboard"])


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(user: CurrentUserDep) -> dict:
    """Role-specific overview: the student's or the lecturer's own data only."""
    return dashboard_service.get_dashboard(user)


@router.get("/timetable", response_model=TimetableOut)
def timetable(
    user: CurrentUserDep,
    date_from: Annotated[date | None, Query(alias="from")] = None,
    date_to: Annotated[date | None, Query(alias="to")] = None,
) -> dict:
    return timetable_service.get_timetable(user, date_from, date_to)
