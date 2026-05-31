/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // The legacy static site lives under `htmls/` and at the repo root; it is not
  // part of the Next.js build. Standalone output keeps the Docker runtime lean.
  output: 'standalone',
};

export default nextConfig;
