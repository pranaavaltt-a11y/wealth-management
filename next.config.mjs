/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  experimental: { serverComponentsExternalPackages: ['pg', 'mongodb', 'bcryptjs', 'pdfkit', 'tesseract.js'] },
};
export default nextConfig;
