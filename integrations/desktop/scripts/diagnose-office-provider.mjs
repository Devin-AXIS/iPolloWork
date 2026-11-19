import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {pathToFileURL} from 'node:url';

const [installation,inputs]=process.argv.slice(2);
const require=createRequire(join(resolve(installation),'package.json'));
const {Context}=await import(pathToFileURL(require.resolve('@deepseek-ai/cordis')).href);
const {default:OfficeKit}=await import(pathToFileURL(require.resolve('@deepseek-ai/dsh-office-kit')).href);
const output=await mkdtemp(join(tmpdir(),'office-provider-output-'));
const ctx=new Context();
const operation=async(label,work)=>{
 const started=Date.now();console.log(JSON.stringify({event:'begin',label,time:new Date().toISOString()}));
 try{const result=await work();console.log(JSON.stringify({event:'pass',label,milliseconds:Date.now()-started}));return result;}
 catch(error){console.error(JSON.stringify({event:'fail',label,milliseconds:Date.now()-started,code:error?.code,message:error?.message}));throw error;}
};
try{
 await ctx.plugin(OfficeKit,{timeoutMs:180000,outputDirectory:output});
 const source=async(extension,kind)=>{
  const bytes=await readFile(join(inputs,'input.'+extension));
  return {key:'probe-'+kind+'-'+extension,version:'fixture',bytes:bytes.length,async read(){return {bytes,version:'fixture'};}};
 };
 for(const extension of ['docx','xlsx','pptx']) await operation('pdf-'+extension,async()=>{
  const result=await ctx.officeKit.convert({extension,priority:'foreground',source:await source(extension,'pdf')});
  if(!Buffer.from(result.pdf).subarray(0,8).toString().startsWith('%PDF-')) throw Error('Invalid PDF');
 });
 for(const extension of ['docx','xlsx','pptx']){
  await operation('images-'+extension,async()=>{
   const result=await ctx.officeKit.renderImages({extension,source:await source(extension,'images'),maxImages:4,maxPixels:16777216,maxDimension:8192,maxBytes:64*1024*1024});
   if(!result.images.length) throw Error('No images');
  });
  await operation('convert-'+extension,async()=>{
   const format={docx:'odt',xlsx:'ods',pptx:'odp'}[extension];
   const result=await ctx.officeKit.convertTo({extension,format,source:await source(extension,'convert'),output:{owner:'probe',name:'converted.'+format}});
   if((await readFile(result.path)).subarray(0,4).toString('hex')!=='504b0304') throw Error('Invalid converted ZIP');
  });
  if(extension==='xlsx') await operation('recalculate-xlsx',async()=>{
   const result=await ctx.officeKit.recalculate({extension,format:'xlsx',source:await source(extension,'recalculate'),output:{owner:'probe',name:'recalculated.xlsx'}});
   if((await readFile(result.path)).subarray(0,4).toString('hex')!=='504b0304') throw Error('Invalid recalculated ZIP');
  });
 }
}finally{await ctx.fiber.dispose();await rm(output,{recursive:true,force:true});}
