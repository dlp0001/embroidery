# База

Локально Postgres поднимается докером:

```bash
docker run -d --name recreate-postgres \
  -e POSTGRES_PASSWORD=dev -e POSTGRES_USER=dev -e POSTGRES_DB=recreate \
  -p 5442:5432 postgres:18-alpine
```

Дальше схема и тестовые данные:

```bash
npm run migrate
npm run seed
```

`seed` очищает студийные таблицы и заливает четыре группы, четырёх человек
и историю посещений за месяц. На проде его запускать нельзя.

Миграции лежат в `migrations/`, применяются по имени и только один раз.
Новая миграция — новый файл с номером больше предыдущего.
