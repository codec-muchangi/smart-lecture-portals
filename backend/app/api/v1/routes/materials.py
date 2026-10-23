from typing import Annotated
from uuid import UUID

from fastapi import APIRouter, Depends, File, Form, Query, Response, UploadFile
from fastapi.exceptions import RequestValidationError

from app.core.errors import ValidationFailed
from app.core.limits import upload_limit
from app.core.security import CurrentUserDep, LecturerDep
from app.schemas.common import DownloadOut, Page
from app.schemas.material import DESCRIPTION_MAX, TITLE_MAX, MaterialCategory, MaterialOut, MaterialUpdate
from app.services import material_service

# Course-scoped: /courses/{course_id}/materials
course_router = APIRouter(prefix="/courses/{course_id}/materials", tags=["materials"])
# Material-scoped: /materials/{material_id}
material_router = APIRouter(prefix="/materials", tags=["materials"])

PageNo = Annotated[int, Query(ge=1)]
PageSize = Annotated[int, Query(ge=1, le=100)]


@course_router.get("", response_model=Page[MaterialOut])
def list_materials(
    course_id: UUID,
    user: CurrentUserDep,
    page: PageNo = 1,
    page_size: PageSize = 20,
    q: Annotated[str | None, Query(max_length=100)] = None,
    category: MaterialCategory | None = None,
) -> dict:
    return material_service.list_materials(
        user, course_id, q=q, category=category, page=page, page_size=page_size
    )


_TRUE, _FALSE = {"true", "1", "yes", "on"}, {"false", "0", "no", "off"}


def _form_bool(raw: str | None, *, default: bool, field: str) -> bool:
    """A multipart flag. Parsed here because newer FastAPI versions turn a MISSING boolean form field into
    False, which would silently turn the documented default (published) off."""
    if raw is None or raw.strip() == "":
        return default
    value = raw.strip().lower()
    if value in _TRUE | _FALSE:
        return value in _TRUE
    raise RequestValidationError(
        [{"loc": ("body", field), "msg": "Input should be true or false", "type": "bool_parsing"}]
    )


@course_router.post("", status_code=201, response_model=MaterialOut, dependencies=[Depends(upload_limit)])
def upload_material(
    course_id: UUID,
    user: LecturerDep,
    file: Annotated[UploadFile, File(description="PDF, DOCX, PPTX, XLSX, CSV, PNG, JPG/JPEG or ZIP")],
    title: Annotated[str, Form(min_length=1, max_length=TITLE_MAX)],
    description: Annotated[str | None, Form(max_length=DESCRIPTION_MAX)] = None,
    category: Annotated[MaterialCategory, Form()] = "other",
    published: Annotated[str | None, Form(description="true (default) or false")] = None,
) -> dict:
    return material_service.create_material(
        user,
        course_id,
        title=title,
        description=description,
        category=category,
        published=_form_bool(published, default=True, field="published"),
        file_obj=file.file,
        original_name=file.filename,
    )


@material_router.get("/{material_id}/download", response_model=DownloadOut)
def download_material(material_id: UUID, user: CurrentUserDep) -> dict:
    return material_service.get_download(user, material_id)


@material_router.patch("/{material_id}", response_model=MaterialOut)
def update_material(material_id: UUID, body: MaterialUpdate, user: LecturerDep) -> dict:
    changes = body.model_dump(exclude_unset=True)
    if not changes:
        raise ValidationFailed("No updatable fields supplied")
    return material_service.update_material(user, material_id, changes)


@material_router.delete("/{material_id}", status_code=204)
def delete_material(material_id: UUID, user: LecturerDep) -> Response:
    material_service.delete_material(user, material_id)
    return Response(status_code=204)
