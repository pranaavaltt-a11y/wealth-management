/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { serverComponentsExternalPackages: ['pg', 'mongodb', 'bcryptjs'] },
};
export default nextConfig;
