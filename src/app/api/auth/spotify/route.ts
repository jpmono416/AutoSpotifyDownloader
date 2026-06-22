import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { saveOAuthState, cleanupExpiredOAuthStates } from "@/lib/db";
import { buildSpotifyAuthUrl } from "@/lib/platforms";
import { getRedirectUri } from "@/lib/auth/tokens";

export async function GET() {
  cleanupExpiredOAuthStates();
  const state = randomBytes(24).toString("hex");
  saveOAuthState({ state, platform: "spotify", redirectAfter: "/" });
  const url = buildSpotifyAuthUrl(state, getRedirectUri("spotify"));
  return NextResponse.redirect(url);
}
