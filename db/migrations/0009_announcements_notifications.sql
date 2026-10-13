-- Phase 7: announcements and in-app notifications (SRS 4.9 FR-NOT-01..04, FR-LEC-13, FR-STU-10, 9.2, 15;
-- AT-17, AT-18). Run once, after 0001-0008.
begin;

-- =====================================================================================================
-- 1. Announcements
-- =====================================================================================================
-- A published announcement always has a publication time (the first time it was published).
alter table announcements add constraint announcements_publish_consistency
  check (published = false or published_at is not null);

-- The author must be a lecturer assigned to the course; course and author never change; never hard-deleted
-- (hide an announcement by unpublishing it).
create or replace function trg_announcements_guard() returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'announcements are never hard-deleted; unpublish instead' using errcode = '23514';
  elsif tg_op = 'INSERT' then
    if not exists (select 1 from course_lecturers where course_id = new.course_id and lecturer_id = new.created_by) then
      raise exception 'author is not assigned to this course' using errcode = '23514';
    end if;
  elsif new.course_id <> old.course_id or new.created_by <> old.created_by then
    raise exception 'announcement course and author are immutable' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger announcements_guard before insert or update or delete on announcements
  for each row execute function trg_announcements_guard();

-- =====================================================================================================
-- 2. Notifications
-- =====================================================================================================
-- is_read and read_at always agree.
alter table notifications add constraint notifications_read_consistency
  check (is_read = (read_at is not null));

-- A notification's content never changes; only the read flag does, and a read notification stays read.
create or replace function trg_notifications_guard() returns trigger language plpgsql as $$
begin
  if new.user_id <> old.user_id or new.type <> old.type or new.title <> old.title
     or new.message <> old.message or new.link is distinct from old.link or new.created_at <> old.created_at then
    raise exception 'notification content is immutable' using errcode = '23514';
  end if;
  if old.is_read and not new.is_read then
    raise exception 'a read notification cannot become unread' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger notifications_guard before update on notifications
  for each row execute function trg_notifications_guard();

-- =====================================================================================================
-- 3. Transactional operations (service role only)
-- =====================================================================================================
-- 3a. One notification per ACTIVELY enrolled student of a course. Returns how many were created.
create or replace function notify_course_students(
  p_course uuid, p_type notification_type, p_title text, p_message text, p_link text
) returns integer language plpgsql set search_path = public as $$
declare n integer;
begin
  insert into notifications (user_id, type, title, message, link)
  select e.student_id, p_type, p_title, p_message, p_link
  from course_enrollments e where e.course_id = p_course and e.status = 'active';
  get diagnostics n = row_count;
  return n;
end $$;

-- 3b. Create an announcement. When it is published straight away, the students are notified in the SAME
--     transaction (FR-NOT-03), together with the audit row. Returns {announcement, notified}.
create or replace function create_announcement(
  p_course uuid, p_actor uuid, p_title text, p_body text, p_publish boolean
) returns jsonb language plpgsql set search_path = public as $$
declare a announcements%rowtype; n integer := 0;
begin
  insert into announcements (course_id, title, body, published, published_at, created_by)
  values (p_course, p_title, p_body, p_publish, case when p_publish then now() end, p_actor)
  returning * into a;
  insert into audit_logs (actor_user_id, action, entity_type, entity_id, old_value, new_value)
  values (p_actor, case when p_publish then 'announcement.publish' else 'announcement.create' end,
          'announcement', a.id, null,
          jsonb_build_object('course_id', p_course, 'title', p_title, 'published', p_publish));
  if p_publish then
    n := notify_course_students(p_course, 'announcement', 'New announcement: ' || p_title,
                                left(p_body, 200), '/student/courses/' || p_course);
  end if;
  return jsonb_build_object('announcement', to_jsonb(a), 'notified', n);
end $$;

-- 3c. Edit, publish or unpublish. p_changes holds any of title, body, published. The students are notified
--     only the FIRST time an announcement is published (re-publishing after an unpublish does not notify
--     again). A call that changes nothing writes nothing. Returns {announcement, notified}.
create or replace function update_announcement(p_id uuid, p_actor uuid, p_changes jsonb)
returns jsonb language plpgsql set search_path = public as $$
declare
  old_row announcements%rowtype; a announcements%rowtype;
  new_title text; new_body text; new_pub boolean; first_publish boolean;
  old_v jsonb := '{}'::jsonb; new_v jsonb := '{}'::jsonb; act text := 'announcement.update'; n integer := 0;
begin
  select * into old_row from announcements where id = p_id for update;
  if not found then
    raise exception 'announcement not found' using errcode = 'P0002';
  end if;
  new_title := case when p_changes ? 'title' then p_changes ->> 'title' else old_row.title end;
  new_body := case when p_changes ? 'body' then p_changes ->> 'body' else old_row.body end;
  new_pub := case when p_changes ? 'published' then (p_changes ->> 'published')::boolean else old_row.published end;

  if new_title is distinct from old_row.title then
    old_v := old_v || jsonb_build_object('title', old_row.title);
    new_v := new_v || jsonb_build_object('title', new_title);
  end if;
  if new_body is distinct from old_row.body then
    old_v := old_v || jsonb_build_object('body', old_row.body);
    new_v := new_v || jsonb_build_object('body', new_body);
  end if;
  if new_pub is distinct from old_row.published then
    old_v := old_v || jsonb_build_object('published', old_row.published);
    new_v := new_v || jsonb_build_object('published', new_pub);
    act := case when new_pub then 'announcement.publish' else 'announcement.unpublish' end;
  end if;
  if new_v = '{}'::jsonb then
    return jsonb_build_object('announcement', to_jsonb(old_row), 'notified', 0);
  end if;

  first_publish := new_pub and old_row.published_at is null;
  update announcements set title = new_title, body = new_body, published = new_pub,
    published_at = case when first_publish then now() else old_row.published_at end
  where id = p_id returning * into a;
  insert into audit_logs (actor_user_id, action, entity_type, entity_id, old_value, new_value)
  values (p_actor, act, 'announcement', p_id, old_v, new_v);
  if first_publish then
    n := notify_course_students(a.course_id, 'announcement', 'New announcement: ' || a.title,
                                left(a.body, 200), '/student/courses/' || a.course_id);
  end if;
  return jsonb_build_object('announcement', to_jsonb(a), 'notified', n);
end $$;

revoke all on function notify_course_students(uuid, notification_type, text, text, text) from public, anon, authenticated;
grant execute on function notify_course_students(uuid, notification_type, text, text, text) to service_role;
revoke all on function create_announcement(uuid, uuid, text, text, boolean) from public, anon, authenticated;
grant execute on function create_announcement(uuid, uuid, text, text, boolean) to service_role;
revoke all on function update_announcement(uuid, uuid, jsonb) from public, anon, authenticated;
grant execute on function update_announcement(uuid, uuid, jsonb) to service_role;

commit;
