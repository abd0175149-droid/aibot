/** @type {import('next').NextConfig} */
export default {
  output: 'standalone',
  reactStrictMode: true,
  // الواجهة تنادي الـAPI عبر نفس النطاق (/api) — فلا CORS ولا عنوانٌ مختلف
  async rewrites() {
    return [{
      source: '/api/:path*',
      destination: `${process.env.API_INTERNAL_URL ?? 'http://127.0.0.1:4100'}/api/:path*`,
    }];
  },
};
