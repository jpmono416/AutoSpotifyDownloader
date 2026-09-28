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
