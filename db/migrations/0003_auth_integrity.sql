-- Phase 1: identity integrity + atomic provisioning.
-- Run after 0001/0002. Run once only.
begin;

-- 1. A profile's id and role can never change after creation.
create or replace function trg_profiles_immutable() returns trigger language plpgsql as $$
begin
  if new.id <> old.id or new.role <> old.role then
    raise exception 'profiles.id and profiles.role are immutable' using errcode = '23514';
  end if;
  return new;
end $$;
create trigger profiles_immutable before update on profiles
  for each row execute function trg_profiles_immutable();

-- 2. students/lecturers rows may only attach to a profile with the matching role.
create or replace function trg_role_row_matches_profile() returns trigger language plpgsql as $$
declare actual user_role;
begin
  select role into actual from profiles where id = new.id;
  if actual is distinct from tg_argv[0]::user_role then
    raise exception 'profile % does not have role %', new.id, tg_argv[0] using errcode = '23514';
  end if;
  return new;
end $$;
create trigger students_role_check  before insert or update of id on students
  for each row execute function trg_role_row_matches_profile('student');
create trigger lecturers_role_check before insert or update of id on lecturers
  for each row execute function trg_role_row_matches_profile('lecturer');

-- 3. Atomic provisioning: profile + role row in ONE transaction.
create or replace function provision_profile(
  p_id uuid, p_role user_role, p_full_name text, p_email text, p_phone text default null,
  p_registration_number text default null, p_program text default null, p_year_of_study smallint default null,
  p_staff_number text default null, p_department text default null, p_title text default null
) returns void language plpgsql set search_path = public as $$
begin
  insert into profiles (id, role, full_name, email, phone)
  values (p_id, p_role, p_full_name, lower(p_email), p_phone);

  if p_role = 'student' then
    if p_registration_number is null then
      raise exception 'registration_number is required for students' using errcode = '23502';
    end if;
    insert into students (id, registration_number, program, year_of_study)
    values (p_id, p_registration_number, p_program, p_year_of_study);
  else
    if p_staff_number is null then
      raise exception 'staff_number is required for lecturers' using errcode = '23502';
    end if;
    insert into lecturers (id, staff_number, department, title)
    values (p_id, p_staff_number, p_department, p_title);
  end if;
end $$;

revoke all on function provision_profile(uuid, user_role, text, text, text, text, text, smallint, text, text, text)
  from public, anon, authenticated;
grant execute on function provision_profile(uuid, user_role, text, text, text, text, text, smallint, text, text, text)
  to service_role;

commit;