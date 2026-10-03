"""Retry removal of stored files for deleted materials (retention rule, SRS 4.5 FR-MAT-05).

Deleting a material soft-deletes its row and removes its file. If the storage service was unavailable at that
moment the file stays behind with file_removed_at empty; this script removes such leftovers. Safe to run any
time and as often as you like (for example weekly):

  cd backend
  python ../scripts/purge_deleted_materials.py
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))

from app.services.material_service import purge_removed_files  # noqa: E402

removed, failed = purge_removed_files()
print(f"Removed {removed} leftover file(s); {failed} still failing.")
sys.exit(1 if failed else 0)
