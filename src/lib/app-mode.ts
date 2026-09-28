import { timingSafeEqual } from "node:crypto";

type Environment = Record<string, string | undefined>;
const HOSTED_MARKERS = ["VERCEL", "VERCEL_ENV", "VERCEL_URL", "RAILWAY_ENVIRONMENT_ID", "RAILWAY_PROJECT_ID", "RAILWAY_SERVICE_ID", "RAILWAY_ENVIRONMENT_NAME", "RAILWAY_PUBLIC_DOMAIN", "RENDER", "RENDER_SERVICE_ID", "FLY_APP_NAME", "HEROKU_APP_NAME", "DYNO", "AWS_LAMBDA_FUNCTION_NAME", "K_SERVICE", "WEBSITE_INSTANCE_ID", "NETLIFY", "CF_PAGES", "DO_APP_ID"];
let announced = false;

export function appMode(env: Environment = process.env): "production" | "local" {
  const mode = env.APP_MODE ?? "production";
  if (mode !== "production" && mode !== "local") throw new Error("APP_MODE must be production or local.");
  if (mode === "local") {
    if (HOSTED_MARKERS.some(key => Boolean(env[key])) || env.BACKEND_URL || (env.NEXT_PUBLIC_APP_URL && !loopbackUrl(env.NEXT_PUBLIC_APP_URL))) {
      throw new Error("Local mode is forbidden on hosted environments or with remote application URLs.");
    }
    if (!env.LOCAL_DATABASE_URL || !loopbackUrl(env.LOCAL_DATABASE_URL)) {
      throw new Error("Local mode requires an explicit loopback LOCAL_DATABASE_URL for a dedicated Postgres database.");
    }
  }
  return mode;
}

export function loopbackAddress(value: string): boolean {
  return ["127.0.0.1", "::1", "::ffff:127.0.0.1", "localhost", "[::1]"].includes(value.toLowerCase());
}
export function loopbackUrl(value: string): boolean {
  try { return loopbackAddress(new URL(value).hostname); } catch { return false; }
}
export function announceMode() {
  const mode = appMode();
  if (!announced) {
    console[mode === "local" ? "warn" : "info"](JSON.stringify({ event: "mode_selection", mode, message: mode === "local" ? "WARNING: LOCAL SINGLE-USER MODE. No account authentication. Bind only to loopback; never proxy or publish this server." : "Secure multi-user mode" }));
    announced = true;
  }
  return mode;
}

/** Proof is inserted only by the loopback launcher after inspecting the socket. */
export function trustedLocalRequest(headers: Pick<Headers, "get">, env: Environment = process.env, frameworkForwarding = false): boolean {
  if (appMode(env) !== "local") return false;
  const expected = env.LOCAL_REQUEST_SECRET;
  const actual = headers.get("x-asd-local-proof");
  if (!expected || !actual || expected.length !== actual.length || !timingSafeEqual(Buffer.from(expected), Buffer.from(actual))) return false;
  if (!loopbackUrl(`http://${headers.get("host") ?? ""}`)) return false;
  const origin = headers.get("origin");
  if (origin && origin !== `http://${headers.get("host")}`) return false;
  const forwardedFor=headers.get("x-forwarded-for");
  return !headers.get("forwarded") && (!forwardedFor || (frameworkForwarding && loopbackAddress(forwardedFor)));
}
