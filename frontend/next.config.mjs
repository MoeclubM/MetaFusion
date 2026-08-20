/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "**.metafusion.io",
      },
      {
        protocol: "https",
        hostname: "**.r2.cloudflarestorage.com",
      },
      {
        protocol: "http",
        hostname: "localhost",
      },
    ],
  },
  output: "standalone",
  async redirects() {
    return [
      { source: "/upload", destination: "/contribute", permanent: true },
      { source: "/submit", destination: "/contribute", permanent: true },
    ];
  },
};

export default nextConfig;
