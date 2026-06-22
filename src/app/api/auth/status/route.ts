import { NextResponse } from "next/server";
import { getConnectionStatus } from "@/lib/db";

export async function GET() {
  return NextResponse.json(getConnectionStatus());
}
