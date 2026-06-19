import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { saveOAuthState, cleanupExpiredOAuthStates } from "@/lib/db";
import { buildGoogleAuthUrl } from "@/lib/platforms";

export async function GET() {
  cleanupExpiredOAuthStates();
  const state = randomBytes(24).toString("hex");
  saveOAuthState({ state, platform: "youtube", redirectAfter: "/" });
  const url = buildGoogleAuthUrl(state);
  return NextResponse.redirect(url);
}
