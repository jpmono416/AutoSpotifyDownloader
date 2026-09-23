import { NextResponse } from "next/server";
import { createSession, verifyPassword } from "@/lib/auth/session";
import { sql } from "@/lib/db";
export async function POST(request:Request) { const {username,password}=await request.json() as {username?:string;password?:string}; const rows=await sql`select id,password_hash from users where lower(username)=lower(${username?.trim()??""})`; const user=rows[0]; if(!user || !password || !(await verifyPassword(password,user.password_hash))) return NextResponse.json({error:"Invalid username or password."},{status:401}); await createSession(user.id); return NextResponse.json({ok:true}); }
