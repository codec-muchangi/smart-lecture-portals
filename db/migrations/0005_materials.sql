-- Phase 3: course materials & private file storage (SRS 4.5, 14, 15). Run once, after 0001-0004.
begin;

-- 1. Retention bookkeeping. A deleted material keeps its metadata row (history/audit) but its stored file is
--    removed. file_removed_at is NULL until the stored object has really been deleted, so a failed removal can
--    be retried (scripts/purge_deleted_materials.py) instead of silently leaving an orphan file behind.
alter table materials add column file_removed_at timestamptz;
alter table materials add constraint materials_storage_path_unique unique (storage_path);
alter table materials add constraint materials_deleted_not_published check (deleted_at is null or published = false);
alter table materials add constraint materials_file_removed_after_delete check (file_removed_at is null or deleted_at is not null);

-- 2. Integrity triggers.
--    a) file identity is fixed at upload; only title/description/category/published/deleted flags may change;
--    b) rows are never hard-deleted (soft delete only), so history cannot vanish by accident;
--    c) the uploader must be a lecturer assigned to the course (defence in depth behind the API check).
create or replace function trg_materials_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'materials are soft-deleted (set deleted_at); hard delete is not allowed' using errcode = '23514';
  elsif tg_op = 'UPDATE' then
    if new.course_id <> old.course_id or new.storage_path <> old.storage_path or new.file_name <> old.file_name
       or new.mime_type <> old.mime_type or new.file_size <> old.file_size or new.uploaded_by <> old.uploaded_by then
      raise exception 'material file details and ownership are immutable' using errcode = '23514';
    end if;
    return new;
  else
    if not exists (select 1 from course_lecturers where course_id = new.course_id and lecturer_id = new.uploaded_by) then
      raise exception 'uploader is not assigned to this course' using errcode = '23514';
    end if;
    return new;
  end if;
end $$;
create trigger materials_guard before insert or update or delete on materials
  for each row execute function trg_materials_guard();

-- 3. Indexes for the list endpoint and the retention job.
create index materials_course_listing_idx on materials (course_id, created_at desc) where deleted_at is null;
create index materials_pending_removal_idx on materials (deleted_at) where deleted_at is not null and file_removed_at is null;

-- 4. Storage-level limits as a second wall behind the API checks (25 MB, supported types only).
--    The bucket stays private; storage.objects has RLS enabled and no client policies, so only the backend's
--    service role can read or write objects.
update storage.buckets
set public = false,
    file_size_limit = 26214400,
    allowed_mime_types = array[
      'application/pdf',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'text/csv',
      'image/png',
      'image/jpeg',
      'application/zip'
    ]
where id = 'materials';

commit;
