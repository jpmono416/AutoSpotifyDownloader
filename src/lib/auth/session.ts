import "server-only";
import { cookies } from "next/headers";
import { createHash, randomBytes, scrypt as scryptCallback, timingSafeEqual } from "crypto";
import { promisify } from "util";
import { sql } from "../db";

const scrypt = promisify(scryptCallback);
const COOKIE_NAME = "playlist_session";
const SESSION_DAYS = 30;

export interface AuthUser { id: string; username: string }

function tokenHash(token: string) { return createHash("sha256").update(token).digest("hex"); }

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt.toString("hex")}:${derived.toString("hex")}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [algorithm, saltHex, hashHex] = stored.split(":");
  if (algorithm !== "scrypt" || !saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = (await scrypt(password, Buffer.from(saltHex, "hex"), expected.length)) as Buffer;
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_DAYS * 86400_000);
  await sql`insert into sessions (user_id,token_hash,expires_at) values (${userId},${tokenHash(token)},${expiresAt})`;
  (await cookies()).set(COOKIE_NAME, token, { httpOnly:true, secure:process.env.NODE_ENV === "production", sameSite:"lax", path:"/", expires:expiresAt });
}

export async function getCurrentUser(): Promise<AuthUser | null> {
  const token = (await cookies()).get(COOKIE_NAME)?.value;
  if (!token) return null;
  const rows = await sql`select u.id,u.username from sessions s join users u on u.id=s.user_id where s.token_hash=${tokenHash(token)} and s.expires_at>now()`;
  return rows[0] ? { id:rows[0].id, username:rows[0].username } : null;
}

export async function deleteCurrentSession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(COOKIE_NAME)?.value;
  if (token) await sql`delete from sessions where token_hash=${tokenHash(token)}`;
  jar.delete(COOKIE_NAME);
}

export async function requireUser(): Promise<AuthUser> {
  const user = await getCurrentUser();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}
