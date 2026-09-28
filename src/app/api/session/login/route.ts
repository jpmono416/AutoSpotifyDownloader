import { appMode } from "@/lib/app-mode";
import { NextResponse } from "next/server";
import { createSession, verifyPassword } from "@/lib/auth/session";
import { sql } from "@/lib/db";
export async function POST(request:Request) { if(appMode()==="local") return NextResponse.json({error:"Local workspace is opened only by the trusted loopback launcher."},{status:403}); const {username,password}=await request.json() as {username?:string;password?:string}; const rows=await sql`select id,password_hash from users where is_local_system=false and lower(username)=lower(${username?.trim()??""})`; const user=rows[0]; if(!user || !password || !(await verifyPassword(password,user.password_hash))) return NextResponse.json({error:"Invalid username or password."},{status:401}); await createSession(user.id); return NextResponse.json({ok:true}); }
