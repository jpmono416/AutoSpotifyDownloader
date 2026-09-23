import { NextRequest, NextResponse } from "next/server";
import { consumeOAuthState, savePlatformTokens } from "@/lib/db";
import { exchangeSpotifyCode } from "@/lib/platforms";
import { getAppUrl, getRedirectUri } from "@/lib/auth/tokens";

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
  if (!oauthState || oauthState.platform !== "spotify") {
    return NextResponse.redirect(`${getAppUrl()}/?error=invalid_state`);
  }

  try {
    const tokens = await exchangeSpotifyCode(code, getRedirectUri("spotify"));
    await savePlatformTokens(oauthState.userId, "spotify", tokens);
    return NextResponse.redirect(`${getAppUrl()}${oauthState.redirectAfter}?connected=spotify`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "auth_failed";
    return NextResponse.redirect(`${getAppUrl()}/?error=${encodeURIComponent(message)}`);
  }
}
