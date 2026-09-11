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
        protocol: "https",
        hostname: "lain.bgm.tv",
      },
      {
        protocol: "https",
        hostname: "image.tmdb.org",
      },
      {
        protocol: "https",
        hostname: "coverartarchive.org",
      },
      {
        protocol: "https",
        hostname: "media.vgm.io",
      },
      {
        protocol: "http",
        hostname: "localhost",
      },
    ],
  },
  output: "standalone",
  async rewrites() {
    return [{source:"/api/:path*",destination:`${process.env.BACKEND_ORIGIN || "http://127.0.0.1:8080"}/api/:path*`}];
  },
  async redirects() {
    return [
      { source: "/upload", destination: "/contribute", permanent: true },
      { source: "/submit", destination: "/contribute", permanent: true },
      // 旧轨详情页已退役：统一到通用兜底 /catalog/:id（EntityDetailView 支持全 kind）。
      { source: "/artists/:id", destination: "/catalog/:id", permanent: true },
      { source: "/franchises/:id", destination: "/catalog/:id", permanent: true },
      { source: "/canonical-entries/:id", destination: "/catalog/:id", permanent: true },
      { source: "/artists/new", destination: "/new?kind=agent", permanent: true },
      { source: "/franchises/new", destination: "/new?kind=collection", permanent: true },
      { source: "/works/new", destination: "/new?kind=work", permanent: true },
      { source: "/releases/new", destination: "/new?kind=release", permanent: true },
    ];
  },
};

export default nextConfig;
