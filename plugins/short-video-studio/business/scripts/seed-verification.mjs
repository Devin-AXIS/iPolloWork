// Reproducible local fixture only. Does not call generation or change Work state.
import { readFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import createService from '../src/service.mjs';
import { addNode, uuid } from '../src/project.mjs';
const root=resolve('.dev-data/workspace'), dataDir=resolve('.dev-data/private');
await mkdir(root,{recursive:true});await mkdir(dataDir,{recursive:true});
const {actions}=await createService({workspace:{root},storage:{dataDir},host:{callAction:async()=>{throw new Error('Fixture mode has no generation provider')}}});
let {project:p}=await actions['project-create']({title:'多轨媒体验收 · 测试素材'});
for(const [name,durationSeconds] of [['test-shot.mp4',4],['test-music.wav',8]]){
  const bytes=await readFile(resolve('.dev-data/fixtures',name)),uploadId=uuid('u');
  for(let offset=0;offset<bytes.length;offset+=1024*1024){const result=await actions['asset-upload']({projectId:p.id,uploadId,filename:name,total:bytes.length,offset,data:bytes.subarray(offset,offset+1024*1024).toString('base64'),durationSeconds,hasAudio:true});if(result.project)p=result.project;}
}
const [video,audio]=p.assets;
const first=addNode(p,'video',{x:80,y:80});first.title='测试镜头 A';first.assetId=video.id;first.prompt='测试图案，用于确认视频可解码；不是 AI 生成示例。';
const second=addNode(p,'audio',{x:380,y:80});second.title='独立配乐';second.assetId=audio.id;
p.edges.push({id:uuid('e'),from:first.id,to:second.id});
p.shots=[{id:uuid('s'),title:'镜头 A',prompt:'测试',narration:'第一段 · 可编辑字幕',duration:2,assetId:video.id},{id:uuid('s'),title:'镜头 B',prompt:'测试',narration:'第二段 · 可编辑字幕',duration:2,assetId:video.id}];
({project:p}=await actions['project-save']({project:p}));
({project:p}=await actions.arrange({projectId:p.id,revision:p.revision}));
p.tracks.push({id:uuid('t'),label:'配乐',kind:'audio',clips:[{id:uuid('c'),label:'测试配乐',source:`assets/${audio.file}`,startFrame:0,durationFrames:120,sourceDurationSeconds:8,volume:.2,playbackRate:1}]});
({project:p}=await actions['project-save']({project:p}));
console.log(JSON.stringify({projectId:p.id,title:p.title,tracks:p.tracks.length,clips:p.tracks.reduce((n,t)=>n+t.clips.length,0)}));
