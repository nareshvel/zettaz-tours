import type { NextConfig } from "next";

const verboseRequestLog =
  process.env.NEXT_REQUEST_LOG === "verbose" ||
  process.env.NEXT_REQUEST_LOG === "1";

const config: NextConfig = {
  poweredByHeader: false,
  reactStrictMode: true,
  experimental: { cpus: 2 },
  // Dev request dumps (GET /api/session …) stay quiet unless NEXT_REQUEST_LOG=verbose.
  logging: verboseRequestLog
    ? undefined
    : {
        incomingRequests: false,
      },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
        ],
      },
    ];
  },
};
export default config;
