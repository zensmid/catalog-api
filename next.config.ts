import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Netlify handles output
  output: "standalone",

  // Allow images from common CDN domains
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "**.netlify.app" },
      { protocol: "https", hostname: "**.cloudinary.com" },
    ],
  },

  // Expose public env vars to browser
  env: {
    NEXT_PUBLIC_APP_URL: process.env.AUTH0_BASE_URL ?? "",
  },
};

export default nextConfig;
