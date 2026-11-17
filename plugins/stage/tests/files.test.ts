import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm,symlink,writeFile,mkdir,readdir} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {sourceFile,saveMovie} from '../src/files.ts';
test('source boundaries reject external symlinks and growing-size limits; downloads cannot replace a user file',async()=>{
 const root=await mkdtemp(join(tmpdir(),'stage-files-')),outside=await mkdtemp(join(tmpdir(),'stage-other-'));
 try{
  await writeFile(join(root,'brief.txt'),'A source');assert.equal((await sourceFile(root,'brief.txt')).base64,Buffer.from('A source').toString('base64'));
  await writeFile(join(outside,'private.txt'),'Private');await symlink(join(outside,'private.txt'),join(root,'link.txt'));await assert.rejects(sourceFile(root,'link.txt'),/inside/);
  await writeFile(join(root,'large.txt'),Buffer.alloc(5*1024*1024+1));await assert.rejects(sourceFile(root,'large.txt'),/5 MB/);
  const bytes=Buffer.alloc(1200);bytes.write('ftyp',4);const movie=()=>new Response(bytes,{headers:{'Content-Type':'video/mp4'}}),id='a'.repeat(32),signal=new AbortController().signal;
  const first=await saveMovie(root,id,movie(),signal);await writeFile(first,'User edited file');const second=await saveMovie(root,id,movie(),signal);assert.notEqual(first,second);assert.equal(await readFile(first,'utf8'),'User edited file');assert.deepEqual(await readFile(second),bytes);
  await assert.rejects(saveMovie(root,id,new Response('not a movie'),signal),/video/);assert(!(await readdir(join(root,'stage-exports'))).some(name=>name.endsWith('.part')));
  await rm(join(root,'stage-exports'),{recursive:true});await symlink(outside,join(root,'stage-exports'));await assert.rejects(saveMovie(root,id,movie(),signal),/inside/);
 }finally{await rm(root,{recursive:true,force:true});await rm(outside,{recursive:true,force:true});}
});
