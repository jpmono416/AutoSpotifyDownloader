import type { Sql } from "postgres";
import { appMode } from "./app-mode";

export const LOCAL_WORKSPACE_USERNAME = "__local_workspace__";
export async function ensureLocalWorkspace(sql: Sql) {
  if (appMode() !== "local") throw new Error("Local workspace requires trusted local mode.");
  // Reserved username; never promote an existing account to a system identity.
  await sql`insert into users(username,password_hash,is_local_system) values(${LOCAL_WORKSPACE_USERNAME},'disabled:local-system',true) on conflict do nothing`;
  const rows = await sql`select id,username from users where username=${LOCAL_WORKSPACE_USERNAME} and is_local_system=true`;
  if (!rows[0]) throw new Error("Reserved local workspace username conflicts with an existing account.");
  return { id: String(rows[0].id), username: String(rows[0].username) };
}
