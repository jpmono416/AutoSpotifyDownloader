import test from "node:test";
import assert from "node:assert/strict";
import { appMode, trustedLocalRequest, loopbackAddress } from "../src/lib/app-mode";
const local = { APP_MODE:"local", LOCAL_DATABASE_URL:"postgresql://test:test@127.0.0.1:5432/test", LOCAL_REQUEST_SECRET:"a".repeat(64) };
function headers(extra:Record<string,string>={}) { return new Headers({host:"127.0.0.1:3000","x-asd-local-proof":local.LOCAL_REQUEST_SECRET,...extra}); }
test("production is default even with NODE_ENV development",()=>{assert.equal(appMode({}),"production");assert.equal(appMode({NODE_ENV:"development"}),"production");});
test("local is explicit and requires dedicated loopback database",()=>{assert.equal(appMode(local),"local");assert.throws(()=>appMode({APP_MODE:"local"}),/LOCAL_DATABASE_URL/);assert.throws(()=>appMode({...local,LOCAL_DATABASE_URL:"postgresql://test:test@db.supabase.co/test"}),/LOCAL_DATABASE_URL/);assert.throws(()=>appMode({APP_MODE:"invalid"}));});
for(const marker of ["VERCEL","VERCEL_ENV","RAILWAY_ENVIRONMENT_ID","RAILWAY_PROJECT_ID","RAILWAY_SERVICE_ID","RAILWAY_ENVIRONMENT_NAME","RENDER","FLY_APP_NAME","DYNO","AWS_LAMBDA_FUNCTION_NAME","K_SERVICE","NETLIFY","CF_PAGES"]) test(`local rejected with ${marker}`,()=>assert.throws(()=>appMode({...local,[marker]:"production"}),/forbidden/));
test("remote app URL and backend proxy reject local mode",()=>{assert.throws(()=>appMode({...local,NEXT_PUBLIC_APP_URL:"https://example.com"}),/forbidden/);assert.throws(()=>appMode({...local,BACKEND_URL:"http://localhost:3001"}),/forbidden/);});
test("trusted local proof permits cookie-free browser requests",()=>assert.equal(trustedLocalRequest(headers(),local),true));
test("remote, forged, cross-origin and forwarded requests cannot bypass",()=>{for(const h of [headers({host:"example.com"}),headers({"x-asd-local-proof":"b".repeat(64)}),headers({origin:"https://evil.test"}),headers({"x-forwarded-for":"127.0.0.1"}),new Headers({host:"localhost:3000"})]) assert.equal(trustedLocalRequest(h,local),false);assert.equal(loopbackAddress("192.168.1.5"),false);});
test("proof never permits production authentication bypass",()=>assert.equal(trustedLocalRequest(headers(),{APP_MODE:"production",LOCAL_REQUEST_SECRET:local.LOCAL_REQUEST_SECRET}),false));
