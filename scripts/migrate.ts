#!/usr/bin/env tsx
import { readFileSync } from "fs";
import { join } from "path";
import postgres from "postgres";
import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());
const databaseUrl=process.env.DATABASE_URL;
if(!databaseUrl) throw new Error("DATABASE_URL is required.");
async function main() {
  const sql=postgres(databaseUrl!,{ssl:databaseUrl!.includes("localhost")||databaseUrl!.includes("127.0.0.1")?false:"require",prepare:false,max:1});
  await sql.unsafe(readFileSync(join(process.cwd(),"supabase","migrations","001_initial.sql"),"utf8"));
  await sql.end();
  console.log("Database schema is up to date.");
}
main().catch((error) => { console.error(error); process.exit(1); });
