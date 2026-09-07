import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  async headers() {
    return [{
      source: "/:path*",
      headers: [
        { key: "Content-Security-Policy", value: "base-uri 'self'; frame-ancestors 'none'; form-action 'self'; object-src 'none'" },
        { key: "Referrer-Policy", value: "same-origin" },
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" }
      ]
    }];
  },
  // Only the webpack build cache needs to be excluded from the standalone trace -- it's huge
  // (100s of MB) and never read at runtime. Excluding all of `.next/**` (as a prior version of
  // this config did) also excludes `.next/server/chunks/*.js`, which webpack-runtime.js requires
  // at runtime via dynamic `require('./chunks/<id>.js')` calls the tracer can't resolve
  // statically as "keep" -- that produced `Cannot find module './chunks/<id>.js'` in the
  // standalone build (GitHub issue #7: missing chunk on a clean Docker build).
  outputFileTracingExcludes: {
    "/*": ["./storage/**/*", "./prisma/*.db", "./prisma/*.db-*", "./.next/cache/**/*"]
  },
  serverExternalPackages: ["@prisma/client"],
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "i.ytimg.com" },
      { protocol: "https", hostname: "img.youtube.com" },
      { protocol: "https", hostname: "yt3.ggpht.com" },
      { protocol: "https", hostname: "*.googleusercontent.com" }
    ]
  }
};

export default nextConfig;
