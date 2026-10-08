// Package authored native compositions. No browser, layout renderer or conversion.
import {readFileSync,writeFileSync,readdirSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {fileURLToPath} from 'node:url';
import {Script} from 'node:vm';

const lib=fileURLToPath(new URL('../',import.meta.url));
const out=resolve(process.argv[2]||join(lib,'dist/hyperframes'));
const groups=new Map(),catalog=[];
for(const name of readdirSync(join(lib,'src')).sort()){
 const dir=join(lib,'src',name);
 const manifest=JSON.parse(readFileSync(join(dir,'registry-item.json'),'utf8'));
 if(!manifest.motionRecipe?.usage?.example?.narration?.trim())throw Error('Missing motion narration example: '+name);
 const files={};
 for(const file of manifest.files){
  const path=resolve(dir,file.path);
  if(!path.startsWith(dir+'/'))throw Error('File escapes component: '+file.path);
  const content=readFileSync(path,'utf8');
  if(file.type==='hyperframes:composition'){
   // Native markup only: HTML text and SVG shapes. The shared engine runtime may re-lay them out from data.
   if(/<stage-diagram[\s>]|<foreignObject|<text[\s>]/i.test(content.replace(/<script[\s\S]*?<\/script>/gi,'')))throw Error('Non-native composition: '+name);
   for(const match of content.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi))new Script(match[1],{filename:file.path});
   for(const slot of manifest.visualComponent.ai.slots)if(!content.includes(`data-ipw-ai-slot="${slot}"`))throw Error('Missing AI slot: '+name+'/'+slot);
  }
  files[file.path]=content;
 }
 const group=manifest.tags[2];
 if(!groups.has(group))groups.set(group,[]);
 groups.get(group).push({manifest,files});
 catalog.push(`| ${manifest.name} | ${manifest.title} | ${manifest.description} | ${manifest.visualComponent.data?'共用数据表格 + 原生图层':'原生文字与图层'} |`);
}
if(catalog.length!==35)throw Error('The library must contain all 35 native components.');
mkdirSync(out,{recursive:true});
for(const [group,items]of groups){
 writeFileSync(join(out,'stage-diagrams-'+group+'.hfcomponent.json'),JSON.stringify({format:'hyperframes:components',version:1,items}));
 console.log(group,items.length,'native components');
}
writeFileSync(join(lib,'skill/catalog.md'),'# 商业图库组件目录\n\n所有组件均直接维护原生 HTML 文字、SVG 图形和暂停 GSAP 时间线。使用当前视频 Studio 的组件导入、文字、图层、动画和共用数据控件。定性结构图不代表实测数据。\n\n| 组件 | 名称 | 用途 | 编辑方式 |\n| --- | --- | --- | --- |\n'+catalog.join('\n')+'\n');
