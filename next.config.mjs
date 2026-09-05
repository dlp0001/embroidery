/** @type {import('next').NextConfig} */

// Страницы, которые пока живут статикой в public/legacy.
// Rewrite по умолчанию срабатывает ПОСЛЕ роутов приложения,
// поэтому любой из этих адресов можно перенести в app/ и он победит.
const legacy = [
  'embroidery', 'register', 'video', 'materials', 'materials2',
  'portfolio', 'israeli-hints', 'camp',
  'agreement', 'privacy-ru', 'consent-data', 'consent-marketing',
  'terms', 'refunds', 'privacy',
];

const nextConfig = {
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
