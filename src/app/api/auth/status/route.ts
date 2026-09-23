import { NextResponse } from "next/server";
import { getConnectionStatus } from "@/lib/db";
import { getPlatformConfigurationStatus } from "@/lib/platform-config";
import { requireUser } from "@/lib/auth/session";

export async function GET() {
  let user; try { user=await requireUser(); } catch { return NextResponse.json({error:"Unauthorized"},{status:401}); }
  return NextResponse.json({
    connected: await getConnectionStatus(user.id),
    configured: getPlatformConfigurationStatus(),
  });
}
