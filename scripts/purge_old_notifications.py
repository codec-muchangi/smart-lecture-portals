"""Retention rule for notifications (SRS 4.9, Phase 9): delete notifications that were READ more than N days
ago (default 90, minimum 30). Unread notifications are never deleted. Each run is recorded in the audit log.
Safe to run any time and as often as you like (for example weekly):

  cd backend
  python ../scripts/purge_old_notifications.py            # 90 days
  python ../scripts/purge_old_notifications.py --days 180
"""
import argparse
import sys
from pathlib import Path

sys.path.insert(0, str(Path.cwd()))

from app.core.errors import ValidationFailed  # noqa: E402
from app.services.notification_service import purge_read_notifications  # noqa: E402

parser = argparse.ArgumentParser(description="Delete notifications read more than N days ago.")
parser.add_argument("--days", type=int, default=90, help="keep read notifications this long (minimum 30)")
days = parser.parse_args().days
try:
    removed = purge_read_notifications(days)
except ValidationFailed as exc:
    print(exc.message)
    sys.exit(2)
print(f"Deleted {removed} notification(s) read more than {days} days ago.")
