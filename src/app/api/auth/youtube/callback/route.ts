import { NextRequest, NextResponse } from "next/server";
import { consumeOAuthState, savePlatformTokens } from "@/lib/db";
import { exchangeGoogleCode } from "@/lib/platforms";
import { getAppUrl } from "@/lib/auth/tokens";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const code = searchParams.get("code");
  const state = searchParams.get("state");
  const error = searchParams.get("error");

  if (error) {
    return NextResponse.redirect(`${getAppUrl()}/?error=${encodeURIComponent(error)}`);
  }

  if (!code || !state) {
    return NextResponse.redirect(`${getAppUrl()}/?error=missing_code`);
  }

  const oauthState = await consumeOAuthState(state);
  if (!oauthState || oauthState.platform !== "youtube") {
    return NextResponse.redirect(`${getAppUrl()}/?error=invalid_state`);
  }

  try {
    const tokens = await exchangeGoogleCode(code);
    await savePlatformTokens(oauthState.userId, "youtube", tokens);
    return NextResponse.redirect(`${getAppUrl()}${oauthState.redirectAfter}?connected=youtube`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "auth_failed";
    return NextResponse.redirect(`${getAppUrl()}/?error=${encodeURIComponent(message)}`);
  }
}
