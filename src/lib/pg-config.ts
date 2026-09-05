/**
 * Neon требует SSL, локальный докер его не умеет. Разбираем по хосту,
 * чтобы одна и та же строка подключения работала в обоих местах.
 */
export function pgConfig(connectionString: string | undefined) {
  if (!connectionString) return { connectionString };
  let local = false;
  try {
    const host = new URL(connectionString).hostname;
    local = host === 'localhost' || host === '127.0.0.1' || host.endsWith('.local');
  } catch {
    // строка неразбираемая — считаем внешней и включаем SSL
  }
  return local ? { connectionString } : { connectionString, ssl: { rejectUnauthorized: true } };
}
