import test from "node:test";
import assert from "node:assert/strict";
import { sourceIdentities, resolveCachedTarget } from "../src/lib/sync/cache";
const match={id:"test",targetTrackId:"A".repeat(11),lastVerifiedAt:null,confidence:75,confirmationState:"automatic"};
test("ISRC precedes provider and carefully normalized metadata identities",()=>assert.deepEqual(sourceIdentities({id:"source",platform:"spotify",isrc:"USABC1234567",title:"Song!",artist:"Artist",durationSec:120}),["isrc:USABC1234567","spotify:source","metadata:artist:song:120"]));
test("imported cache hit avoids searching",async()=>{let searches=0,hits=0;const id=await resolveCachedTarget(match,{validate:async()=>true,invalidate:async()=>{},verified:async()=>{},hit:async()=>{hits++;}});if(!id)searches++;assert.equal(searches,0);assert.equal(hits,1);});
test("invalid video invalidates then falls back to search",async()=>{let invalidations=0,searches=0;const id=await resolveCachedTarget(match,{validate:async()=>false,invalidate:async()=>{invalidations++;},verified:async()=>{},hit:async()=>assert.fail("not a hit")});if(!id)searches++;assert.equal(invalidations,1);assert.equal(searches,1);});
test("network failures do not invalidate otherwise valid matches",async()=>{await assert.rejects(resolveCachedTarget(match,{validate:async()=>{throw new Error("network");},invalidate:async()=>assert.fail(),verified:async()=>{},hit:async()=>{}}),/network/);});
