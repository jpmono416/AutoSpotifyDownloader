import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { saveOAuthState, cleanupExpiredOAuthStates } from "@/lib/db";
import { buildGoogleAuthUrl } from "@/lib/platforms";
import { isPlatformConfigured, platformConfigurationMessage } from "@/lib/platform-config";
import { requireUser } from "@/lib/auth/session";
import { getAppUrl } from "@/lib/auth/tokens";

export async function GET() {
  let user; try { user=await requireUser(); } catch { return NextResponse.redirect(new URL("/login", getAppUrl())); }
  if (!isPlatformConfigured("youtube")) {
    return NextResponse.json({ error: platformConfigurationMessage("youtube") }, { status: 503 });
  }
  await cleanupExpiredOAuthStates();
  const state = randomBytes(24).toString("hex");
  await saveOAuthState(user.id, { state, platform: "youtube", redirectAfter: "/" });
  const url = buildGoogleAuthUrl(state);
  return NextResponse.redirect(url);
}
