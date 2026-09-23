import { NextResponse } from "next/server";
import { getConnectionStatus, sql } from "@/lib/db";
import { getPlatformConfigurationStatus } from "@/lib/platform-config";
import { requireUser } from "@/lib/auth/session";
import { downloadsEnabled, isQaUser } from "@/lib/jobs";

export async function GET() {
  let user; try { user=await requireUser(); } catch { return NextResponse.json({error:"Unauthorized"},{status:401}); }
  const [connected,tokenRows,qaAllowed]=await Promise.all([getConnectionStatus(user.id),sql`select platform,expires_at,scope from platform_tokens where user_id=${user.id}`,isQaUser(user.id)]);
  const details=Object.fromEntries(tokenRows.map(row=>[row.platform,{state:row.expires_at&&new Date(row.expires_at).getTime()<Date.now()?"expired":"connected",expiresAt:row.expires_at,scope:row.scope}]));
  return NextResponse.json({
    connected,
    configured: getPlatformConfigurationStatus(),
    details,
    downloads:{enabled:downloadsEnabled(),qaAllowed},
  });
}
