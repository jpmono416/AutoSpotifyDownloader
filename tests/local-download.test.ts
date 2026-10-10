import test from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile, rm } from "node:fs/promises";
import { join, resolve } from "node:path";
import { tmpdir } from "node:os";
import { localDownloadConfig, runLocalDownloads, archiveLines, type LocalDownloadConfig } from "../src/lib/local-download";

test("local config validates missing paths and discovers explicit config without modifying sources",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"asd-config-")),cwd=process.cwd(),env={...process.env};
  try {
    process.chdir(dir);Object.assign(process.env,{APP_MODE:"local",LOCAL_DATABASE_URL:"postgresql://test:test@127.0.0.1/test",LOCAL_MUSIC_DIR:join(dir,"missing")});
    await assert.rejects(localDownloadConfig(),/existing directory/);
    process.env.LOCAL_MUSIC_DIR=dir;process.env.LOCAL_YTDLP_CONFIG=join(dir,"missing-config");
    await assert.rejects(localDownloadConfig(),/configured yt-dlp config is missing/);
    const configFile=join(dir,"config");await writeFile(configFile,"--audio-format flac\n");process.env.LOCAL_YTDLP_CONFIG=configFile;
    const config=await localDownloadConfig();assert.deepEqual(config.configs,[configFile]);assert.equal(config.musicDir,dir);assert.equal(await readFile(configFile,"utf8"),"--audio-format flac\n");
    await writeFile(join(dir,"ytdlp_settings.json"),JSON.stringify({audio_format:"mp3"}));
    assert.equal((await localDownloadConfig()).settingsSource,"ytdlp_settings.json compatibility");
    process.env.LOCAL_YTDLP_ARCHIVE=join(dir,"wrong-archive");await assert.rejects(localDownloadConfig(),/LOCAL_YTDLP_ARCHIVE/);
  } finally {process.chdir(cwd);for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);assert.ok(resolve(dir).startsWith(resolve(tmpdir())));await rm(dir,{recursive:true,force:true});}
});

test("existing archive prevents duplicate local download; only new completed IDs append",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"asd-download-")),cwd=process.cwd(),env={...process.env};
  try {
    process.chdir(dir);Object.assign(process.env,{APP_MODE:"local",LOCAL_DATABASE_URL:"postgresql://test:test@127.0.0.1/test"});
    const seed=join(dir,"seed.log"),archive=join(dir,"active.log"),fake=join(dir,"fake.cjs");
    const prior="A".repeat(11),fresh="B".repeat(11);await writeFile(seed,`youtube ${prior}\n`);await writeFile(archive,"");
    await writeFile(fake,`const fs=require('fs');const a=process.argv;const path=a[a.indexOf('--download-archive')+1];const text=fs.readFileSync(path,'utf8');if(!text.includes('youtube ${prior}'))process.exit(2);if(!text.includes('youtube ${fresh}'))fs.appendFileSync(path,'youtube ${fresh}\\n');`);
    const config:LocalDownloadConfig={musicDir:dir,configs:[],archive,seedArchives:[seed],python:process.execPath,executable:process.execPath,extraArgs:[fake],format:"flac",quality:"0",settingsSource:"test"};
    const hooks={cancelled:async()=>false,progress:async()=>{},history:[]};
    await runLocalDownloads(config,[{youtubeId:"PL"+"C".repeat(32),name:"Test"}],hooks);
    const first=await readFile(archive,"utf8");assert.deepEqual(archiveLines(first),[`youtube ${fresh}`]);
    await runLocalDownloads(config,[{youtubeId:"PL"+"C".repeat(32),name:"Test"}],hooks);
    assert.equal(await readFile(archive,"utf8"),first);assert.equal(await readFile(seed,"utf8"),`youtube ${prior}\n`);
    process.env.APP_MODE="production";await assert.rejects(runLocalDownloads(config,[],hooks),/trusted local mode/);
  } finally {process.chdir(cwd);for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);assert.ok(resolve(dir).startsWith(resolve(tmpdir())));await rm(dir,{recursive:true,force:true});}
});

test("cancellation terminates the local downloader process tree",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"asd-cancel-")),cwd=process.cwd(),env={...process.env};
  try {
    process.chdir(dir);Object.assign(process.env,{APP_MODE:"local",LOCAL_DATABASE_URL:"postgresql://test:test@127.0.0.1/test"});
    const fake=join(dir,"wait.cjs");await writeFile(fake,"setInterval(()=>{},1000);");
    const config:LocalDownloadConfig={musicDir:dir,configs:[],archive:join(dir,"archive.log"),seedArchives:[],python:process.execPath,executable:process.execPath,extraArgs:[fake],format:"flac",quality:"0",settingsSource:"test"};
    let calls=0;const started=Date.now();
    await runLocalDownloads(config,[{youtubeId:"PL"+"C".repeat(32),name:"Test"}],{cancelled:async()=>++calls>1,progress:async()=>{},history:[]});
    assert.ok(Date.now()-started<5000,"downloader must stop promptly after cancellation");
  } finally {process.chdir(cwd);for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);assert.ok(resolve(dir).startsWith(resolve(tmpdir())));await rm(dir,{recursive:true,force:true});}
});

test("track errors finish with skips, keep good downloads and continue to the next playlist",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"asd-skip-")),cwd=process.cwd(),env={...process.env};
  try {
    process.chdir(dir);Object.assign(process.env,{APP_MODE:"local",LOCAL_DATABASE_URL:"postgresql://test:test@127.0.0.1/test"});
    const fake=join(dir,"skip.cjs"),archive=join(dir,"archive.log"),good="G".repeat(11),bad="B".repeat(11);
    await writeFile(fake,`const fs=require('fs'),a=process.argv;const path=a[a.indexOf('--download-archive')+1];if(a.at(-1).includes('${"C".repeat(32)}')){fs.appendFileSync(path,'youtube ${good}\\n');console.error('WARNING: Authorization: Bearer sensitive-value');console.error('ERROR: [youtube] ${bad}: Video unavailable https://example.test/?token=private access_token=secret');console.log('[download] Finished downloading playlist: first');process.exitCode=1;}else{console.log('[download] Finished downloading playlist: second');}`);
    const config:LocalDownloadConfig={musicDir:dir,configs:[],archive,seedArchives:[],python:process.execPath,executable:process.execPath,extraArgs:[fake],format:"flac",quality:"0",settingsSource:"test"};
    const progress:number[]=[];
    const result=await runLocalDownloads(config,[{youtubeId:"PL"+"C".repeat(32),name:"First"},{youtubeId:"PL"+"D".repeat(32),name:"Second"}],{cancelled:async()=>false,progress:async current=>{progress.push(current);},history:[]});
    assert.deepEqual(progress,[1,2]);assert.equal(result.skippedTracks.length,1);assert.equal(result.skippedTracks[0].videoId,bad);
    assert.deepEqual(archiveLines(await readFile(archive,"utf8")),[`youtube ${good}`]);
    const log=await readFile(result.diagnosticFile,"utf8");assert.match(log,/Video unavailable/);assert.ok(!log.includes('private'));assert.ok(!log.includes('secret'));assert.ok(!log.includes('sensitive-value'));assert.match(log,/\[redacted\]/);
  } finally {process.chdir(cwd);for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);assert.ok(resolve(dir).startsWith(resolve(tmpdir())));await rm(dir,{recursive:true,force:true});}
});

test("playlist and setup failures stay failures with captured diagnostics",async()=>{
  const dir=await mkdtemp(join(tmpdir(),"asd-fatal-")),cwd=process.cwd(),env={...process.env};
  try {
    process.chdir(dir);Object.assign(process.env,{APP_MODE:"local",LOCAL_DATABASE_URL:"postgresql://test:test@127.0.0.1/test"});
    const fake=join(dir,"fatal.cjs");await writeFile(fake,"console.error('ERROR: [youtube:tab] Playlist does not exist');process.exitCode=1;");
    const config:LocalDownloadConfig={musicDir:dir,configs:[],archive:join(dir,"archive.log"),seedArchives:[],python:process.execPath,executable:process.execPath,extraArgs:[fake],format:"flac",quality:"0",settingsSource:"test"};
    await assert.rejects(runLocalDownloads(config,[{youtubeId:"PL"+"C".repeat(32),name:"Missing"}],{cancelled:async()=>false,progress:async()=>{assert.fail('failed playlist cannot report completion');},history:[]}),/Playlist does not exist/);
    await writeFile(fake,"console.error('ERROR: [youtube] BBBBBBBBBBB: Video unavailable');process.exitCode=2;");
    await assert.rejects(runLocalDownloads(config,[{youtubeId:"PL"+"C".repeat(32),name:"Bad process"}],{cancelled:async()=>false,progress:async()=>{},history:[]}),/yt-dlp failed/);
    await writeFile(fake,"console.error('ERROR: invalid configuration');console.log('[download] Finished downloading playlist: misleading');");
    await assert.rejects(runLocalDownloads(config,[{youtubeId:"PL"+"C".repeat(32),name:"Invalid config"}],{cancelled:async()=>false,progress:async()=>{},history:[]}),/invalid configuration/);
  } finally {process.chdir(cwd);for(const key of Object.keys(process.env))if(!(key in env))delete process.env[key];Object.assign(process.env,env);assert.ok(resolve(dir).startsWith(resolve(tmpdir())));await rm(dir,{recursive:true,force:true});}
});
