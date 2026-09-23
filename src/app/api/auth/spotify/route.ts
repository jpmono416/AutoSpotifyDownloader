import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { saveOAuthState, cleanupExpiredOAuthStates } from "@/lib/db";
import { buildSpotifyAuthUrl } from "@/lib/platforms";
import { getAppUrl, getRedirectUri } from "@/lib/auth/tokens";
import { isPlatformConfigured, platformConfigurationMessage } from "@/lib/platform-config";
import { requireUser } from "@/lib/auth/session";

export async function GET() {
  let user; try { user=await requireUser(); } catch { return NextResponse.redirect(new URL("/login", getAppUrl())); }
  if (!isPlatformConfigured("spotify")) {
    return NextResponse.json({ error: platformConfigurationMessage("spotify") }, { status: 503 });
  }
  await cleanupExpiredOAuthStates();
  const state = randomBytes(24).toString("hex");
  await saveOAuthState(user.id, { state, platform: "spotify", redirectAfter: "/" });
  const url = buildSpotifyAuthUrl(state, getRedirectUri("spotify"));
  return NextResponse.redirect(url);
}
