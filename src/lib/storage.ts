import { createReadStream } from "fs";
import { stat } from "fs/promises";
import { Readable } from "stream";

const bucket=process.env.DOWNLOAD_BUCKET??"qa-downloads";
function config(){ const url=process.env.SUPABASE_URL?.replace(/\/$/,""); const key=process.env.SUPABASE_SERVICE_ROLE_KEY; if(!url||!key) throw new Error("Supabase Storage is not configured."); return {url,key}; }
function headers(key:string,extra:Record<string,string>={}){ return {authorization:`Bearer ${key}`,apikey:key,...extra}; }
export function downloadBucket(){return bucket;}

export async function uploadPrivateObject(objectPath:string,filePath:string):Promise<number>{
  const {url,key}=config(); const info=await stat(filePath);
  const body=Readable.toWeb(createReadStream(filePath)) as ReadableStream;
  const response=await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`,{method:"POST",headers:headers(key,{"content-type":"application/zip","x-upsert":"true"}),body,duplex:"half"} as RequestInit & {duplex:string});
  if(!response.ok) throw new Error(`Storage upload failed (${response.status}).`); return info.size;
}
export async function signPrivateObject(objectPath:string,expiresIn=3600,downloadName?:string):Promise<string>{
  const {url,key}=config(); const response=await fetch(`${url}/storage/v1/object/sign/${encodeURIComponent(bucket)}/${objectPath.split("/").map(encodeURIComponent).join("/")}`,{method:"POST",headers:headers(key,{"content-type":"application/json"}),body:JSON.stringify({expiresIn,download:downloadName??true})});
  if(!response.ok) throw new Error(`Could not create signed link (${response.status}).`); const data=await response.json() as {signedURL?:string;signedUrl?:string}; const path=data.signedURL??data.signedUrl; if(!path) throw new Error("Storage did not return a signed link."); return path.startsWith("http")?path:`${url}/storage/v1${path}`;
}
export async function deletePrivateObjects(paths:string[]):Promise<void>{ if(!paths.length)return; const {url,key}=config(); const response=await fetch(`${url}/storage/v1/object/${encodeURIComponent(bucket)}`,{method:"DELETE",headers:headers(key,{"content-type":"application/json"}),body:JSON.stringify({prefixes:paths})}); if(!response.ok)throw new Error(`Storage cleanup failed (${response.status}).`); }
