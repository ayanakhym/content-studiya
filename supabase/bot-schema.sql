-- Схема для Telegram-бота. Выполнить один раз: Supabase → SQL Editor → вставить → Run.
-- Все операции с балансом — атомарные SQL-функции, чтобы двойные нажатия и повторы
-- вебхуков не списывали и не начисляли кредиты дважды.

create table if not exists bot_users (
  chat_id    bigint primary key,
  credits    int not null default 0 check (credits >= 0),
  pending    text[] not null default '{}',   -- file_id присланных, но ещё не обработанных фото
  last_group text,                           -- media_group_id последнего альбома
  created_at timestamptz not null default now()
);

create table if not exists bot_payments (
  charge_id  text primary key,               -- telegram_payment_charge_id
  chat_id    bigint not null,
  stars      int not null,
  credits    int not null,
  created_at timestamptz not null default now()
);

create table if not exists bot_jobs (
  id         uuid primary key,
  chat_id    bigint not null,
  status     text not null default 'pending', -- pending | done | failed
  created_at timestamptz not null default now()
);

-- Доступ только с серверным ключом: RLS без политик закрывает таблицы для anon/authenticated.
alter table bot_users enable row level security;
alter table bot_payments enable row level security;
alter table bot_jobs enable row level security;

create or replace function bot_ensure_user(p_chat bigint, p_free int) returns void
language sql as $$
  insert into bot_users (chat_id, credits) values (p_chat, greatest(p_free, 0))
  on conflict (chat_id) do nothing;
$$;

create or replace function bot_get_user(p_chat bigint, p_free int default 0)
returns table (credits int, pending text[])
language plpgsql as $$
begin
  perform bot_ensure_user(p_chat, p_free);
  return query select u.credits, u.pending from bot_users u where u.chat_id = p_chat;
end $$;

-- Добавляет фото в очередь пользователя (хранит не больше p_max последних).
-- new_group = true, если это отдельное фото или первое фото нового альбома.
create or replace function bot_add_photo(p_chat bigint, p_file text, p_group text, p_max int, p_free int default 0)
returns table (cnt int, new_group boolean)
language plpgsql as $$
declare
  u bot_users;
  arr text[];
begin
  perform bot_ensure_user(p_chat, p_free);
  select * into u from bot_users where chat_id = p_chat for update;
  arr := u.pending || p_file;
  if array_length(arr, 1) > p_max then
    arr := arr[array_length(arr, 1) - p_max + 1 : array_length(arr, 1)];
  end if;
  update bot_users set pending = arr, last_group = coalesce(p_group, last_group) where chat_id = p_chat;
  return query select array_length(arr, 1), (p_group is null or p_group is distinct from u.last_group);
end $$;

-- Списывает 1 кредит и создаёт задание. p_files — фото для этой генерации;
-- если не передано, берутся накопленные (pending).
-- Если кредитов нет, переданные фото сохраняются в pending, чтобы запустить генерацию после оплаты.
create or replace function bot_start_job(p_chat bigint, p_job uuid, p_min int, p_files text[] default null, p_free int default 0)
returns table (status text, files text[], credits int)
language plpgsql as $$
declare
  u bot_users;
  f text[];
begin
  perform bot_ensure_user(p_chat, p_free);
  select * into u from bot_users where chat_id = p_chat for update;
  f := coalesce(p_files, u.pending);
  if coalesce(array_length(f, 1), 0) < p_min then
    return query select 'no_photos'::text, f, u.credits;
    return;
  end if;
  if u.credits < 1 then
    update bot_users set pending = f where chat_id = p_chat;
    return query select 'no_credits'::text, f, u.credits;
    return;
  end if;
  update bot_users set credits = bot_users.credits - 1, pending = '{}' where chat_id = p_chat;
  insert into bot_jobs (id, chat_id) values (p_job, p_chat);
  return query select 'ok'::text, f, u.credits - 1;
end $$;

-- Закрывает задание. При ошибке возвращает кредит. Повторный вызов ничего не делает
-- и возвращает пустой результат (fal.ai может прислать вебхук несколько раз).
create or replace function bot_finish_job(p_job uuid, p_ok boolean)
returns table (chat_id bigint, credits int)
language plpgsql as $$
declare
  c bigint;
begin
  update bot_jobs j set status = case when p_ok then 'done' else 'failed' end
  where j.id = p_job and j.status = 'pending'
  returning j.chat_id into c;
  if c is null then return; end if;
  if not p_ok then
    update bot_users u set credits = u.credits + 1 where u.chat_id = c;
  end if;
  return query select u.chat_id, u.credits from bot_users u where u.chat_id = c;
end $$;

-- chat_id незакрытого задания (null, если задания нет или оно уже обработано).
create or replace function bot_job_chat(p_job uuid) returns bigint
language sql stable as $$
  select chat_id from bot_jobs where id = p_job and status = 'pending';
$$;

-- Учитывает платёж один раз. Возвращает новый баланс или null для повторного платежа.
create or replace function bot_add_payment(p_charge text, p_chat bigint, p_stars int, p_credits int)
returns int
language plpgsql as $$
declare
  bal int;
begin
  insert into bot_payments (charge_id, chat_id, stars, credits)
  values (p_charge, p_chat, p_stars, p_credits)
  on conflict (charge_id) do nothing;
  if not found then return null; end if;
  perform bot_ensure_user(p_chat, 0);
  update bot_users set credits = bot_users.credits + p_credits where chat_id = p_chat
  returning bot_users.credits into bal;
  return bal;
end $$;

-- По умолчанию функции в public может вызвать кто угодно с публичным ключом. Закрываем.
revoke execute on function bot_ensure_user(bigint, int) from public, anon, authenticated;
revoke execute on function bot_get_user(bigint, int) from public, anon, authenticated;
revoke execute on function bot_add_photo(bigint, text, text, int, int) from public, anon, authenticated;
revoke execute on function bot_start_job(bigint, uuid, int, text[], int) from public, anon, authenticated;
revoke execute on function bot_finish_job(uuid, boolean) from public, anon, authenticated;
revoke execute on function bot_add_payment(text, bigint, int, int) from public, anon, authenticated;
revoke execute on function bot_job_chat(uuid) from public, anon, authenticated;
grant execute on function bot_ensure_user(bigint, int) to service_role;
grant execute on function bot_get_user(bigint, int) to service_role;
grant execute on function bot_add_photo(bigint, text, text, int, int) to service_role;
grant execute on function bot_start_job(bigint, uuid, int, text[], int) to service_role;
grant execute on function bot_finish_job(uuid, boolean) to service_role;
grant execute on function bot_add_payment(text, bigint, int, int) to service_role;
grant execute on function bot_job_chat(uuid) to service_role;
