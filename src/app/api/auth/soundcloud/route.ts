import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { saveOAuthState, cleanupExpiredOAuthStates } from "@/lib/db";
import { buildSoundcloudAuthUrl, generatePkcePair } from "@/lib/platforms";
import { getRedirectUri } from "@/lib/auth/tokens";
import { isPlatformConfigured, platformConfigurationMessage } from "@/lib/platform-config";
import { requireUser } from "@/lib/auth/session";
import { getAppUrl } from "@/lib/auth/tokens";

export async function GET() {
  let user; try { user=await requireUser(); } catch { return NextResponse.redirect(new URL("/login", getAppUrl())); }
  if (!isPlatformConfigured("soundcloud")) {
    return NextResponse.json({ error: platformConfigurationMessage("soundcloud") }, { status: 503 });
  }
  await cleanupExpiredOAuthStates();
  const state = randomBytes(24).toString("hex");
  const { verifier, challenge } = generatePkcePair();
  await saveOAuthState(user.id, {
    state,
    platform: "soundcloud",
    codeVerifier: verifier,
    redirectAfter: "/",
  });
  const url = buildSoundcloudAuthUrl(state, challenge, getRedirectUri("soundcloud"));
  return NextResponse.redirect(url);
}
