-- Видеокурс продаётся без регистрации. Покупатель не становится
-- пользователем сайта: ни users, ни ролей, ни participants. Студия про эти
-- таблицы не знает, и наоборот, поэтому покупатель курса не появится ни в
-- «Людях», ни в журнале, ни в рассылках студии.
--
-- Доступ — это почта плюс срок. Вход — по личной ссылке из письма: она
-- запоминает устройство, и дальше курс открывается без кодов. Устройств на
-- один доступ не больше трёх, чтобы ссылку не раздавали.

alter table courses add column if not exists access_months int not null default 6;
alter table lessons add column if not exists description text;

insert into courses (slug, title, status)
values ('embroidery', 'Как вышить в современном мире', 'published')
on conflict (slug) do nothing;

insert into lessons (course_id, position, slug, title, description, bunny_video_id)
select c.id, v.position, v.slug, v.title, v.description, v.video
  from courses c,
       (values
         (1, 'materials', 'Материалы и инструменты',
          'Разбираем все материалы и инструменты, которые понадобятся для вышивки. Какие пяльцы выбрать, какие нитки использовать, на чём вышивать и как не переплачивать.',
          'cf9e8d57-1ca3-4d42-9409-e616d71744b5'),
         (2, 'stitches', 'Стежки, цвет и буквы',
          'Учимся переносить рисунок на ткань, разбираем разные типы и направления вышивки, говорим о подборе цветов и вышиваем буквы.',
          '4c3a4029-1fcd-4709-bc65-f78476954f12'),
         (3, 'drawing', 'Рисуем и вышиваем',
          'Весь процесс вышивки от А до Я.',
          'caab21c4-915d-4517-b439-8705531ebd44'),
         (4, 'beyond', 'Вышивка и другое',
          'Вышивка бисером, вышивка на обуви и других вещах, использование подручных инструментов.',
          '6748a549-479e-46b4-a7d3-d0b6a8ca50cf')
       ) as v(position, slug, title, description, video)
 where c.slug = 'embroidery'
on conflict (course_id, slug) do nothing;

-- Один доступ на почту и курс. Повторная покупка продлевает срок, а не
-- заводит вторую строку.
create table course_access (
  id            uuid primary key default gen_random_uuid(),
  course_id     uuid not null references courses(id) on delete cascade,
  email         citext not null,
  name          text,
  source        text not null default 'purchase'
                check (source in ('purchase', 'manual', 'legacy')),
  -- Действующая ссылка из письма. Новая ссылка заменяет старую.
  link_hash     text unique,
  link_sent_at  timestamptz,
  -- Ссылку ещё ни разу не открывали: значит, она пришла прямо из почты
  -- покупателя, и при полном комплекте устройств ей можно вытеснить самое
  -- старое. Пересланная ссылка этого права уже не имеет.
  link_used_at  timestamptz,
  expires_at    timestamptz not null,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  unique (course_id, email)
);

-- Оплаты курса. Нужны, чтобы повторный вебхук не продлил доступ дважды,
-- и чтобы Варя видела, кто и чем платил. Деньги студии лежат в payments,
-- сюда не смешиваются.
create table course_orders (
  id           uuid primary key default gen_random_uuid(),
  access_id    uuid not null references course_access(id) on delete cascade,
  provider     text not null,
  provider_id  text not null,
  amount       numeric,
  currency     text,
  raw          jsonb,
  created_at   timestamptz not null default now(),
  unique (provider, provider_id)
);

-- Устройство — это браузер, в котором открыли ссылку. В куке лежит
-- случайный ключ, здесь только его хеш.
create table course_devices (
  id          uuid primary key default gen_random_uuid(),
  access_id   uuid not null references course_access(id) on delete cascade,
  token_hash  text unique not null,
  user_agent  text,
  created_at  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  revoked_at  timestamptz
);
create index course_devices_access_idx on course_devices(access_id) where revoked_at is null;
