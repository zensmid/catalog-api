import arcjet, { shield, tokenBucket, fixedWindow } from "@arcjet/next";

// Base Arcjet instance — extend per-route
export const aj = arcjet({
  key: process.env.ARCJET_KEY!,
  characteristics: ["ip.src"],
  rules: [
    // Block common attacks (SQLi, XSS, path traversal, etc.)
    shield({ mode: "LIVE" }),
  ],
});

// Rate-limited instance for public API endpoints (60 req/min)
export const ajPublicApi = aj.withRule(
  fixedWindow({ mode: "LIVE", window: "60s", max: 60 })
);

// Strict limiter for auth and sensitive endpoints (10 req/min)
export const ajStrict = aj.withRule(
  fixedWindow({ mode: "LIVE", window: "60s", max: 10 })
);
