import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { saveOAuthState, cleanupExpiredOAuthStates } from "@/lib/db";
import { buildSoundcloudAuthUrl, generatePkcePair } from "@/lib/platforms";
import { getRedirectUri } from "@/lib/auth/tokens";

export async function GET() {
  cleanupExpiredOAuthStates();
  const state = randomBytes(24).toString("hex");
  const { verifier, challenge } = generatePkcePair();
  saveOAuthState({
    state,
    platform: "soundcloud",
    codeVerifier: verifier,
    redirectAfter: "/",
  });
  const url = buildSoundcloudAuthUrl(state, challenge, getRedirectUri("soundcloud"));
  return NextResponse.redirect(url);
}
