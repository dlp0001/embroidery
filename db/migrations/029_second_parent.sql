-- Второй родитель.
--
-- Опека и так «много ко многим» (001), и кабинет читается по ней: чтобы
-- второй родитель увидел детей, хватает строки в guardians. Не хватало
-- двух вещей — как его позвать и на кого выписывать квитанции.

-- Приглашение. Одноразовый токен уезжает в ссылку /join/<token>, в базе
-- лежит его хеш — как у login_codes и tg_links, и по тем же причинам: из
-- дампа базы нельзя попасть в чужую семью.
create table if not exists family_invites (
  id          uuid primary key default gen_random_uuid(),
  inviter_id  uuid not null references users(id) on delete cascade,
  token_hash  text not null unique,
  expires_at  timestamptz not null,
  used_at     timestamptz,
  used_by     uuid references users(id) on delete set null,
  created_at  timestamptz not null default now()
);

create index if not exists family_invites_inviter_idx
  on family_invites (inviter_id, created_at desc);

-- На кого студия выписывает квитанцию. Метка переходящая: в семье её
-- держит кто-то один, и его же имя идёт в отчётность, кто бы из двоих
-- ни заплатил. По умолчанию «да» — тогда у всех нынешних родителей всё
-- остаётся как было, а приглашённому ставим «нет»: метка оказывается у
-- того, кто зарегистрировался первым, просто потому что он был первым.
alter table users add column if not exists receipts boolean not null default true;
