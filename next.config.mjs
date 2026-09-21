/** @type {import('next').NextConfig} */

// Страницы, которые пока живут статикой в public/legacy.
// Адрес, переехавший в app/, нужно убрать отсюда: на Vercel этот
// rewrite срабатывает раньше, чем серверная страница приложения, и
// статика молча побеждает. Так случилось с /camp.
const legacy = [
  'embroidery', 'register', 'video', 'materials', 'materials2',
  'portfolio', 'israeli-hints', 'studio',
  'agreement', 'privacy-ru', 'consent-data', 'consent-marketing',
  'terms', 'refunds', 'privacy',
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
    ];
  },
};

export default nextConfig;
