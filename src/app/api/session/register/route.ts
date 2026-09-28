import { appMode } from "@/lib/app-mode";
import { NextResponse } from "next/server";
import { createSession, hashPassword } from "@/lib/auth/session";
import { LOCAL_WORKSPACE_USERNAME } from "@/lib/local-workspace";
import { sql } from "@/lib/db";

export async function POST(request:Request) { if(appMode()==="local") return NextResponse.json({error:"Local workspace is opened only by the trusted loopback launcher."},{status:403});
  const {username,password}=await request.json() as {username?:string;password?:string};
  const normalized=username?.trim();
  if(normalized?.toLowerCase()===LOCAL_WORKSPACE_USERNAME) return NextResponse.json({error:"Reserved system username."},{status:400});
  if(!normalized || !/^[A-Za-z0-9_.-]{3,32}$/.test(normalized)) return NextResponse.json({error:"Username must be 3–32 letters, numbers, dots, dashes, or underscores."},{status:400});
  if(!password || password.length<8 || password.length>200) return NextResponse.json({error:"Password must be at least 8 characters."},{status:400});
  try { const rows=await sql`insert into users (username,password_hash) values (${normalized},${await hashPassword(password)}) returning id`; await createSession(rows[0].id); return NextResponse.json({ok:true},{status:201}); }
  catch(error) { if((error as {code?:string}).code==="23505") return NextResponse.json({error:"That username is already taken."},{status:409}); throw error; }
}
