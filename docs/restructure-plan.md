# План перестройки re-create.art

Статус: черновик, утверждения ждёт. Дата: 2026-09-05.

Решения приняты: Next.js (App Router), Neon Postgres, работа в этом же
репозитории на отдельной ветке, прод на `main` продолжает работать.

Уточнения от 2026-09-05: у ребёнка храним только имя; студия продаётся
через PayPlus со счётом в iCount, в шекелях, рублёвой оплаты у студии нет;
лагерь пока не делаем, на `/camp` ставим заглушку; иврита на сайте студии
не будет; преподаватель пока один, но структура рассчитана на нескольких, а
над админами стоит суперадмин; фото не оптимизируем.

---

## 1. Что есть сейчас

| Слой | Сейчас |
|---|---|
| Страницы | 15 статических HTML в корне |
| Бэкенд | 10 serverless-функций на Vercel, CommonJS |
| Хранилище | Один лист Google Sheets, колонки A..O |
| Платежи | YooKassa (RU), Polar (ILS + INT), Lemon Squeezy, Paddle |
| Видео | Bunny Stream, 4 урока, подписанные токены на 4 часа |
| Почта | Resend, отправитель info@re-create.art |
| Счета | iCount |

Лист Sheets — плоский журнал заявок: дата, имя, email, telegram, способ
оплаты, статус, payment id, сумма, валюта, два согласия с версиями, IP,
user-agent. Права на уроки определяются поиском email по этому листу.

### Сломано в проде

`/video` вызывает `/api/auth-send-code`, `/api/auth-verify-code` и
`/api/auth-check-session`. Все три отдают 404, файлов нет ни в репозитории,
ни в истории git. Оплатившие курс не могут открыть уроки. Чинится отдельно
и раньше всего остального, см. этап 0.

---

## 2. Целевые маршруты и доступ

| Маршрут | Кто видит | Содержимое |
|---|---|---|
| `/` | все | Варя, четыре направления |
| `/embroidery` | все | лендинг и продажа курса вышивки |
| `/knitting` | все | лендинг и продажа курса вязания |
| `/camp` | все | заглушка, лагерь отложен |
| `/studio` | все | лендинг студии, только русский |
| `/login` | все | вход по коду на почту |
| `/account` | вошедший взрослый | сводка |
| `/account/courses` | вошедший взрослый | купленные курсы |
| `/account/children` | родитель | дети и их группы в студии |
| `/account/schedule` | родитель, взрослый ученик | календарь, неделя, запись на занятие |
| `/account/payments` | вошедший взрослый | платежи и квитанции |
| `/account/settings` | вошедший взрослый | профиль, согласия, выход |
| `/learn/embroidery/[lesson]` | есть доступ к курсу | урок, видео, материалы |
| `/learn/knitting/[lesson]` | есть доступ к курсу | то же |
| `/admin/studio` | admin, teacher | группы, посещаемость, абонементы |
| `/admin/studio/today` | teacher | отметка после занятия с телефона |
| `/admin/studio/debts` | admin, teacher | кто сколько должен, напоминания |
| `/admin/camp` | admin | отложено вместе с лагерем |
| `/admin/courses` | admin | ученики и доступы к курсам |
| `/admin/people` | admin | дети, родители, преподаватели |

Преподаватель в `/admin/studio` видит только свои группы. Всё остальное в
`/admin` — только admin.

### Маршруты, которые нельзя менять

Эти адреса зарегистрированы у платёжных провайдеров и в Apple Pay. При
переезде на Next.js они должны отвечать по тем же путям.

```
/terms  /refunds  /privacy  /agreement  /privacy-ru
/consent-data  /consent-marketing
/api/webhook-polar  /api/webhook-lemonsqueezy
/api/webhook-paddle  /api/webhook-yookassa
/.well-known/apple-developer-merchantid-domain-association
```

Отдельная забота — корень. Сейчас `/` это лендинг вышивки, и Polar
возвращает покупателя на `https://re-create.art/?success=true`. После
переезда корень становится хабом. Нужен редирект старых входящих ссылок на
`/embroidery` и правка success-url в кабинетах Polar и Lemon Squeezy.

---

## 3. Модель данных

Postgres в Neon. Взрослые — это `users`, дети — отдельная таблица без
входа, связь многие-ко-многим через `guardians`.

```sql
create table users (
  id          uuid primary key default gen_random_uuid(),
  email       citext unique not null,
  name        text,
  phone       text,
  telegram    text,
  locale      text default 'ru',
  created_at  timestamptz default now()
);

create table user_roles (
  user_id  uuid references users(id) on delete cascade,
  role     text check (role in ('parent','student','teacher','admin','superadmin')),
  primary key (user_id, role)
);

create table children (
  id          uuid primary key default gen_random_uuid(),
  name        text not null,
  created_at  timestamptz default now()
);

create table guardians (
  child_id  uuid references children(id) on delete cascade,
  user_id   uuid references users(id) on delete cascade,
  primary key (child_id, user_id)
);
```

У ребёнка хранится только имя. Ни даты рождения, ни заметок, ни телефона.
Это осознанное ограничение: чем меньше данных несовершеннолетних лежит в
базе, тем короче разговор про согласия и утечки. Возрастные рамки живут на
группе, а не на ребёнке. Связь с родителем — просто связь, без указания
степени родства.

Курсы и доступ:

```sql
create table courses (
  id     uuid primary key default gen_random_uuid(),
  slug   text unique not null,          -- embroidery, knitting
  title  text not null,
  status text default 'draft'
);

create table lessons (
  id              uuid primary key default gen_random_uuid(),
  course_id       uuid references courses(id) on delete cascade,
  position        int not null,
  slug            text not null,
  title           text not null,
  bunny_video_id  text,
  unique (course_id, slug)
);

create table enrollments (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid references users(id) on delete cascade,
  course_id   uuid references courses(id) on delete cascade,
  source      text,                     -- purchase, manual, gift
  granted_at  timestamptz default now(),
  expires_at  timestamptz,
  unique (user_id, course_id)
);

create table lesson_progress (
  user_id    uuid references users(id) on delete cascade,
  lesson_id  uuid references lessons(id) on delete cascade,
  watched_at timestamptz,
  primary key (user_id, lesson_id)
);
```

Студия. Участником занятия может быть и ребёнок, и взрослый: родитель
ходит на субботнюю взрослую группу сам. Поэтому между человеком и
занятием стоит `participants`, а всё студийное ссылается на него, а не на
ребёнка напрямую.

```sql
create table participants (
  id       uuid primary key default gen_random_uuid(),
  child_id uuid references children(id) on delete cascade,
  user_id  uuid references users(id) on delete cascade,
  check (num_nonnulls(child_id, user_id) = 1)
);

create table studio_groups (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  teacher_id  uuid references users(id),
  weekday     int,
  starts_at   time,
  room        text,
  audience    text,                    -- kids | adults, тип занятия
  active      boolean default true
);

create table studio_members (
  group_id       uuid references studio_groups(id) on delete cascade,
  participant_id uuid references participants(id) on delete cascade,
  joined_at      date default current_date,
  left_at        date,
  primary key (group_id, participant_id)
);

create table studio_sessions (
  id        uuid primary key default gen_random_uuid(),
  group_id  uuid references studio_groups(id) on delete cascade,
  held_on   date not null,
  capacity  int,
  status    text default 'planned',
  unique (group_id, held_on)
);

create table bookings (
  id             uuid primary key default gen_random_uuid(),
  session_id     uuid references studio_sessions(id) on delete cascade,
  participant_id uuid references participants(id) on delete cascade,
  status         text default 'booked',   -- booked, cancelled
  created_at     timestamptz default now(),
  unique (session_id, participant_id)
);

create table attendance (
  session_id     uuid references studio_sessions(id) on delete cascade,
  participant_id uuid references participants(id) on delete cascade,
  status         text check (status in ('present','absent','sick','trial')),
  marked_by      uuid references users(id),
  marked_at      timestamptz default now(),
  primary key (session_id, participant_id)
);

create table passes (                    -- абонемент = пакет занятий
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid references users(id) on delete cascade,
  lessons_total  int not null,
  valid_from     date,
  valid_to       date,
  payment_id     uuid,
  created_at     timestamptz default now()
);

create table charges (                   -- деньги за одно посещение
  id             uuid primary key default gen_random_uuid(),
  participant_id uuid references participants(id) on delete cascade,
  session_id     uuid references studio_sessions(id) on delete cascade,
  amount         numeric not null,
  currency       text default 'ILS',
  pass_id        uuid references passes(id),
  payment_id     uuid,
  created_at     timestamptz default now(),
  unique (participant_id, session_id)
);
```

Абонемент принадлежит взрослому, а не ребёнку и не группе. Это пакет
занятий, из которого тратятся посещения любого участника семьи: сам
родитель на субботней взрослой группе, первый ребёнок, второй. Поэтому в
`passes` стоит `owner_id`, а не `participant_id`.

Две модели оплаты живут рядом. Отметка о присутствии заводит строку в
`charges`. Дальше ищем действующий абонемент взрослого, который либо сам
является этим участником, либо записан его опекуном в `guardians`; если
такой есть и в нём остались занятия, строка привязывается к нему через
`pass_id` и денег не требует. Если абонемента нет, строка остаётся
висеть, и это долг. Родитель видит такие строки списком и гасит их одним
платежом.

Когда подходящих абонементов несколько, списываем с того, который раньше
истекает.

Цена занятия одна для всех групп, детских и взрослых: 100 ₪. Поэтому
абонемент можно считать штуками, а не деньгами: «осталось 5 из 8»
остаётся верным, куда бы эти занятия ни ушли. Если цены когда-нибудь
разойдутся, счётчик придётся менять на денежный баланс, и это заденет и
`charges`, и кабинет.

Абонементов два: 4 занятия за 360 ₪ на месяц и 8 занятий за 680 ₪ на два
месяца. Цена пакета задана отдельно от цены занятия, а не выведена
умножением: в этом и смысл абонемента. И цены, и сроки лежат в `settings`
(`studio_lesson_price` и `pass_types`), и меняют их там, а не в коде.

Остаток абонемента по-прежнему не хранится полем: это `lessons_total`
минус число `charges` с этим `pass_id`. Так остаток не расходится с
журналом, и родителю видно одно число на всю семью.

Занятия в `studio_sessions` нужно создавать заранее, на несколько недель
вперёд, иначе календарю и записи не на что ссылаться.

Лагерь отложен, страница `/camp` пока заглушка. Схему оставляю в плане,
чтобы не проектировать её заново, когда лагерь вернётся в работу. Таблицы
не создаём до тех пор.

```sql
create table camp_shifts (
  id        uuid primary key default gen_random_uuid(),
  title     text not null,
  starts_on date not null,
  ends_on   date not null,
  capacity  int,
  price     numeric,
  currency  text,
  status    text default 'draft'
);

create table camp_applications (
  id         uuid primary key default gen_random_uuid(),
  shift_id   uuid references camp_shifts(id) on delete cascade,
  child_id   uuid references children(id),
  parent_id  uuid references users(id),
  status     text default 'new',   -- new, confirmed, paid, cancelled
  payment_id uuid,
  notes      text,
  created_at timestamptz default now()
);
```

Платежи — одна таблица на все четыре провайдера и на наличные в студии:

```sql
create table payments (
  id            uuid primary key default gen_random_uuid(),
  provider      text not null,        -- payplus, yookassa, polar, lemonsqueezy, paddle, cash
  provider_id   text,
  user_id       uuid references users(id),
  amount        numeric not null,
  currency      text not null,
  status        text not null,        -- pending, paid, refunded, failed
  purpose_type  text,                 -- course, pass, camp
  purpose_id    uuid,
  invoice_url   text,
  raw           jsonb,
  created_at    timestamptz default now(),
  unique (provider, provider_id)
);
```

Согласия храним отдельно, с версией текста, потому что это юридический
след и он должен переживать правки профиля:

```sql
create table consents (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid references users(id) on delete cascade,
  kind       text,     -- data, marketing
  version    text,
  granted_at timestamptz default now(),
  ip         text,
  user_agent text
);
```

---

## 4. Вход и роли

Механика остаётся прежней и знакомой ученикам: почта, шестизначный код,
сессия. Меняется место хранения и охват.

- Код живёт в таблице `login_codes`: хеш кода, email, срок 10 минут,
  счётчик попыток, ограничение на частоту запросов.
- Сессия — httpOnly cookie с подписанным токеном, срок 30 дней. Не
  localStorage: сейчас email и токен лежат в localStorage, оттуда их
  читает любой скрипт на странице.
- Роли берём из `user_roles`, у одного человека их может быть несколько.
  Middleware закрывает `/account`, `/learn` и `/admin`.
- Вход разрешён любому взрослому с почтой, а не только оплатившему курс.
  Проверка покупки переезжает на уровень `/learn`, где смотрим
  `enrollments`.
- Токен Bunny выдаём только после проверки доступа к курсу на сервере.
  Сейчас `/api/bunny-token` подписывает любой videoId без проверки, кто
  просит. Это дыра, закрываем на этапе 4.

Пять ролей:

| Роль | Кто это | Что может |
|---|---|---|
| `parent` | родитель | свои дети, их группы, смены, платежи |
| `student` | взрослый ученик | свои курсы и уроки |
| `teacher` | преподаватель | журнал своих групп |
| `admin` | Варя | вся операционка: группы, смены, ученики, доступы |
| `superadmin` | Дима | всё, что admin, плюс роли, интеграции, настройки |

Преподаватель пока один и это Варя, у неё будут сразу `teacher` и `admin`.
Разделение всё равно закладываем в схему: когда появится второй педагог,
достаточно будет выдать ему `teacher` и привязать к группам, а не
переписывать проверки доступа.

---

## 5. Этапы

### Этап 0. Хотфикс входа на уроки — отложен

Три эндпоинта `auth-send-code`, `auth-verify-code`, `auth-check-session`
отсутствуют, вход на `/video` в проде не работает. По твоему решению не
трогаем. Останется сломанным до этапа 4, когда уроки переедут на `/learn`
с нормальной проверкой доступа. Пока держим в голове, что оплатившие
курс сейчас в уроки не попадают.

### Этап 1. Каркас

Частично сделано 2026-09-05 на ветке `restructure`, пока без Next.js:
статикой подняты хаб на `/`, вышивка переехала на `/embroidery`,
добавлены короткие `/studio` и `/camp`, переписаны все внутренние ссылки,
возвраты Polar и YooKassa переведены на `/embroidery`, в `vercel.json`
добавлен редирект `/?success=true`. Next.js встаёт поверх этого.

Ветка `restructure`. Next.js в корне репозитория, TypeScript. Старые
страницы переезжают в `app/` почти без правок разметки, каждая как
отдельный route. Функции `api/*.js` остаются как есть в первом
приближении, чтобы вебхуки не моргнули. Фото не трогаем. Здесь же
появляется заглушка `/camp` с одним словом «скоро». Проверяем превью-деплой Vercel на совпадение
с продом страница за страницей.

### Этап 2. База

Neon, миграции, схема из раздела 3 без таблиц лагеря. Импорт листа
Sheets: строки со статусом «оплачено» становятся `users` плюс
`enrollments` на курс вышивки, все строки — `payments`. Импорт
идемпотентный, гоняем на копии базы, сверяем количество оплативших до и
после.

### Этап 3. Вход и роли

`/login`, сессии в cookie, `user_roles`, middleware. Заводим Варю с
ролями `teacher` и `admin`, Диму с `superadmin`.

### Этап 4. Уроки

`/learn/embroidery/[lesson]` с проверкой `enrollments` на сервере, токен
Bunny только после проверки. Здесь же чинится вход, сломанный сейчас.
`/video` остаётся редиректом на новый адрес.

### Этап 5. Личный кабинет

`/account` и четыре раздела. Дети заводятся родителем: одно поле, имя.

### Этап 6. PayPlus и iCount для студии

Отдельный этап, потому что это внешняя интеграция со своим темпом.
Подключение шлюза, создание платежа, возврат родителя на сайт, вебхук о
результате, запись в `payments`, следом счёт в iCount.

Только шекели. Рублёвой оплаты у студии нет, YooKassa к студии не
подключается и остаётся исключительно на курсах.

Код для iCount уже написан и работает на курсах: функция
`createICountReceipt` в `api/webhook-polar.js` дёргает `doc/create`,
тип документа 320, письмо клиенту отправляет сам iCount. Для студии её
выносим в общий модуль и вызываем из вебхука PayPlus.

НДС остаётся нулевым: Варя — осек патур и НДС не платит. Отдельно стоит
проверить с бухгалтером тип документа. Осек патур выписывает квитанцию,
а не налоговый счёт, и код сейчас создаёт документ типа 320. См. раздел 7.

Нужны доступы к терминалу PayPlus, тестовая среда и ссылка на их
документацию, без этого этап не начинается.

### Этап 7. Студия

Лендинг на русском. Группы, журнал посещаемости, абонементы.
`/admin/studio` для преподавателя и админа. Самый большой кусок работы,
делится ещё раз при подходе.

Кабинет родителя здесь важнее лендинга и делается под телефон, а не под
десктоп. Он ставится на экран «Домой» и открывается как приложение:
манифест, иконки, `display: standalone`, кнопки не мельче 44 точек.
Заказано пять вещей:

1. Родитель может быть учеником сам, взрослые занятия идут в общем
   списке наравне с детскими.
2. Календарь месяца с записью прямо из него.
3. Ближайшая неделя отдельным экраном, чтобы записаться в два касания.
4. История посещений со статусом оплаты каждого.
5. Кнопка, которая гасит все неоплаченные посещения одним платежом.
6. Вкладка «Профиль»: дети добавляются и переименовываются там же, у
   каждого человека отмечаются приоритетные дни недели.

У занятия есть тип, детское или взрослое. Он решает, кого из семьи вообще
можно на него записать: на взрослое только самого родителя, на детское
только детей. Запись делается не кнопкой, а списком имён с галочками:
под каждым занятием видно всех, кому оно подходит, и отмечается тот, кто
придёт. Приоритетные дни из профиля записью не являются, они только
подсвечивают нужные занятия подписью «обычно ходит».

Экран преподавателя тоже телефонный и тоже важнее десктопной админки.
Варя отмечает сразу после занятия, стоя в студии, поэтому отметка должна
занимать один экран и несколько касаний:

- Вкладка «Сегодня» это и есть журнал. Промежуточного экрана нет:
  занятия сегодняшнего дня раскрыты списком имён прямо на ней.
- Состав занятия делится надвое. «Ждём» — те, кого записал родитель или у
  кого этот день недели отмечен в профиле; они заранее отмечены. «Остальные»
  — все прочие, они по умолчанию не отмечены. Обычный день — одно касание
  на занятие.
- Про каждого нужно знать ровно две вещи: был или нет и как оплачено.
  Статусов оплаты три: «не оплачено», «оплачено налом», «по абонементу».
  Они переключаются по кругу нажатием на строчку про деньги; «по
  абонементу» предлагается только тем, у кого пакет действительно есть.
- Статус подставляется сам, но выбирает его Варя. Есть действующий
  абонемент — по умолчанию «по абонементу», нет — «не оплачено». Это
  касается только тех, по кому занятие ещё не считали: сохранённое «не
  оплачено» подставленным абонементом не подменяется.
- После первого сохранения строка со статусом «оплачено налом» или «по
  абонементу» закрыта: чтобы её поправить, нужно подтвердить намерение.
  Изменение попадает в реестр вместе с тем, кто его сделал. Оплату
  картой из журнала снять нельзя вообще: деньги пришли через банк.
- Отдельный экран со списком должников и письмом-напоминанием со ссылкой
  на оплату.
- Занятия прошлых дней, которые забыли отметить, показываются отдельным
  блоком внизу: пока журнал не закрыт, деньги за них не посчитаны.

Десктопный журнал остаётся, но не как основной способ отмечать, а для
разбора задним числом.

### Этап 8. Вязание

Лендинг, продажа, уроки. К этому моменту курс — это данные, а не
отдельная вёрстка. Каналы оплаты те же, что у вышивки.

### Этап 9. Отказ от Sheets

Вебхуки пишут в `payments`, а не в лист. Sheets остаётся выгрузкой для
отчётности, если нужен, но перестаёт быть источником правды.

### Лагерь

Вне очереди. Возвращается отдельным разговором, когда будет решение по
сменам и ценам. Схема в разделе 3 к тому моменту готова, оплата пойдёт
через уже работающий PayPlus.

Этапы 1–4 идут строго по порядку. Шестой можно двигать вперёд, если
раньше появятся доступы к PayPlus. Восьмой и девятый тасуются свободно.

---

## 6. Чего нельзя сломать

1. Продажи курсов. Прод на `main` работает всю перестройку, переключение
   одним слиянием после приёмки на превью. Каналы оплаты курсов не
   трогаем: Polar, Lemon Squeezy, Paddle, YooKassa остаются как есть.
2. Пути юридических страниц и вебхуков из раздела 2.
3. Файл Apple Pay в `.well-known`, переезжает в `public/.well-known/`.
4. Проверка подписи вебхуков требует сырого тела запроса. В App Router
   это `await req.text()` до любого разбора JSON, иначе подписи Polar и
   Lemon Squeezy перестанут сходиться.
5. Роуты с `googleapis` и `crypto` держим на `runtime = 'nodejs'`.
6. Доступ действующих учеников. После импорта проверяем поимённо, что
   каждый оплативший видит уроки.
7. Офлайна у кабинета нет. Приложение на телефоне это та же страница на
   экране «Домой», без сети она не работает. Обещать обратное не надо.
8. Внешний вид страниц. Фото и вёрстку на этапе 1 переносим как есть,
   без оптимизации и без редизайна.
9. Существующий счёт в iCount. Выносим функцию в общий модуль, но
   поведение на курсах остаётся прежним, иначе поедет бухгалтерия.

---

## 7. Решено и что осталось

### Решено 2026-09-05

| Вопрос | Ответ |
|---|---|
| Данные детей | только имя, больше ничего |
| Оплата студии | на занятии наличными, картой, битом или пейбоксом; онлайн — PayPlus плюс счёт в iCount, шекели, рублей нет |
| Оплата курсов | без изменений: Polar, Lemon Squeezy, Paddle, YooKassa |
| Лагерь | отложен, на `/camp` заглушка |
| Иврит | не нужен, сайт студии только на русском |
| Преподаватели | пока одна Варя, в схеме заложено несколько; админы Варя и Дима, Дима суперадмин |
| НДС | ноль, Варя осек патур |
| Заглушка лагеря | текст «скоро», без формы |
| Группы и возраст | жёсткой привязки нет, пока оставляем как есть |
| Кабинет родителя | телефон, приложение на экране «Домой» |
| Отметка посещений | телефон, заранее никто не отмечен, статус оплаты подставляется и правится |
| Абонемент | пакет занятий на семью, тратится и на детей, и на взрослого |
| Расписание | пн, вт, чт с 15:00 — дети, не меньше 90 минут; пт с 12:00 — подростки, 90 минут; сб с 17:00 — взрослые, 90 минут, только по записи |
| Цена занятия | 100 ₪, одна для всех групп, детских и взрослых |
| Абонементы | два: 4 занятия за 360 ₪ на месяц, 8 за 680 ₪ на два месяца |
| Тяжёлые фото | не трогаем |

### Осталось выяснить

1. **Ссылки в рекламе на старый корень.** Хаб занял `/`, и всё, что вело
   на `re-create.art` ради продажи курса, теперь приводит не туда.
   Оплату мы прикрыли редиректом, а вот якорь `re-create.art/#register`
   сервер не видит: посетитель попадёт на хаб и никуда не прокрутится.
   Нужно пройти по объявлениям и постам и поменять адреса на
   `/embroidery`.
2. **Тип документа в iCount.** НДС нулевой и это правильно, Варя осек
   патур. Но осек патур выписывает квитанцию, а не налоговый счёт, тогда
   как код создаёт документ типа 320. Стоит один раз спросить бухгалтера,
   тот ли это документ, и проверить до первого платежа через PayPlus.
   Заодно держим в уме потолок оборота: при переходе в осек мурше
   появится НДС, и поле `vat` перестанет быть нулём.
3. **Доступы к PayPlus.** Учётные данные терминала, тестовая среда и
   ссылка на документацию. До этого этап 6 не планируется точнее.
4. **Строка в политике конфиденциальности.** Даже одно имя ребёнка — это
   персональные данные, внесённые родителем. Нужен абзац про то, что мы
   храним, зачем и как удалить. Одна страница текста, но написать надо до
   запуска студии.
5. **Что делать с оплатившими прямо сейчас.** Вход в уроки не работает и
   чинится только на этапе 4. Если до этого придут новые покупатели, им
   нужен ручной способ получить видео.
6. ~~Что на заглушке лагеря.~~ Решено: просто «скоро», без формы.
