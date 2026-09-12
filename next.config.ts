import path from "path";
import type { NextConfig } from "next";

// Static (no proxy.ts, no nonce) CSP per Next's content-security-policy guide —
// nonces need dynamic rendering, which this static site doesn't otherwise
// require. `unsafe-inline` on script-src is unavoidable here: Next's own
// hydration payload (`self.__next_f.push(...)`) is an inline <script> with no
// fixed content to hash or nonce for. HSTS is left off; Vercel adds it at the
// edge for production domains.
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      "img-src 'self' https://webstore.bulbastore.uk https://mc-heads.net",
      "connect-src 'self' https://webstore.bulbastore.uk wss://webstore.bulbastore.uk https://va.vercel-scripts.com",
      /*
       * `unsafe-eval` in development only. React's dev build calls `eval()` to
       * rebuild callstacks across the server/client boundary, so without it
       * `next dev` logs a CSP violation on every page and loses those stacks.
       * The production bundle never calls it.
       */
      `script-src 'self' 'unsafe-inline'${
        process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""
      } https://va.vercel-scripts.com`,
      "style-src 'self' 'unsafe-inline'",
      "font-src 'self'",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; "),
  },
];

const nextConfig: NextConfig = {
  // A stray package-lock.json in the home directory makes Turbopack infer the
  // wrong workspace root, so pin it to this project.
  turbopack: {
    root: path.join(__dirname),
  },
  poweredByHeader: false,
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
