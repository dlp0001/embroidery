/** @type {import('next').NextConfig} */

// Страницы, которые пока живут статикой в public/legacy.
// Адрес, переехавший в app/, нужно убрать отсюда: на Vercel этот
// rewrite срабатывает раньше, чем серверная страница приложения, и
// статика молча побеждает. Так случилось с /camp.
const legacy = [
  'embroidery',
  'portfolio', 'israeli-hints', 'studio', 'shop',
  'agreement', 'privacy-ru', 'consent-data', 'consent-marketing',
  'terms', 'refunds', 'privacy',
];

// Адреса первого потока. Записи и список материалов теперь живут в курсе
// за личной ссылкой, а старые ссылки разосланы в письмах и чатах — пусть
// ведут туда же. Без доступа /learn сам покажет форму «прислать ссылку».
const moved = [
  { source: '/video', destination: '/learn/embroidery' },
  { source: '/materials', destination: '/learn/embroidery/materials' },
  { source: '/materials2', destination: '/learn/embroidery/materials' },
  // Старая форма записи на поток в Zoom.
  { source: '/register', destination: '/embroidery#register' },
  // Черновик, по которому Варя вычитывала лендинг.
  { source: '/embroidery-new', destination: '/embroidery' },
];

const nextConfig = {
  // Проверочная сборка пишет в свою папку, иначе затирает файлы
  // работающего дев-сервера, и он начинает отдавать 404 и 500.
  distDir: process.env.BUILD_DIR || '.next',
  async rewrites() {
    return [
      { source: '/', destination: '/legacy/index.html' },
      ...legacy.map((p) => ({ source: `/${p}`, destination: `/legacy/${p}.html` })),
    ];
  },
  async redirects() {
    return [
      {
        source: '/',
        has: [{ type: 'query', key: 'success' }],
        destination: '/embroidery?success=true',
        permanent: false,
      },
      ...moved.map((m) => ({ ...m, permanent: false })),
    ];
  },
};

export default nextConfig;
