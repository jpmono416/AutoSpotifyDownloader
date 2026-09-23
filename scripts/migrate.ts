#!/usr/bin/env tsx
import { readFileSync, readdirSync } from "fs";
import { join } from "path";
import postgres from "postgres";
import { loadEnvConfig } from "@next/env";
import { encryptToken } from "../src/lib/auth/token-crypto";
loadEnvConfig(process.cwd());
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL is required.");
async function main() {
  const sql=postgres(databaseUrl!,{ssl:databaseUrl!.includes("localhost")||databaseUrl!.includes("127.0.0.1")?false:"require",prepare:false,max:1});
  const directory=join(process.cwd(),"supabase","migrations");
  for (const filename of readdirSync(directory).filter((name)=>name.endsWith(".sql")).sort()) {
    await sql.unsafe(readFileSync(join(directory,filename),"utf8"));
    console.log(`Applied ${filename}`);
  }
  const legacy=await sql`select user_id,platform,access_token,refresh_token from platform_tokens where access_token is not null`;
  for(const row of legacy){const encrypted=encryptToken(JSON.stringify({accessToken:row.access_token,refreshToken:row.refresh_token}));await sql`update platform_tokens set access_token=null,refresh_token=null,token_ciphertext=${encrypted.ciphertext},token_iv=${encrypted.iv},token_tag=${encrypted.tag},key_version=${encrypted.keyVersion},updated_at=now() where user_id=${row.user_id} and platform=${row.platform}`;}
  if(legacy.length)console.log(`Encrypted ${legacy.length} legacy provider token row(s).`);
  await sql.end();
  console.log("Database schema is up to date.");
}
main().catch((error) => { console.error(error); process.exit(1); });
