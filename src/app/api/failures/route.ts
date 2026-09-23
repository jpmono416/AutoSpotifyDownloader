import { NextResponse } from "next/server";
import { clearOperationFailures, listOperationFailures } from "@/lib/db";
import { requireUser } from "@/lib/auth/session";

export async function GET() {
  try { const user=await requireUser(); return NextResponse.json(await listOperationFailures(user.id)); } catch { return NextResponse.json({error:"Unauthorized"},{status:401}); }
}

export async function DELETE() {
  try { const user=await requireUser(); await clearOperationFailures(user.id); return NextResponse.json({ cleared: true }); } catch { return NextResponse.json({error:"Unauthorized"},{status:401}); }
}
