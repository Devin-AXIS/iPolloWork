import {execFileSync} from 'node:child_process';

if(process.platform!=='darwin'||process.env.GITHUB_ACTIONS!=='true') throw Error('CI macOS diagnostics only');
const sampled=new Set();
setInterval(()=>{
 try{
  const rows=execFileSync('/bin/ps',['-axo','pid=,ppid=,etime=,%cpu=,rss=,command='],{encoding:'utf8',timeout:5000}).split('\n');
  for(const row of rows){
   if(!row.includes('libreoffice-kit-darwin-x64/bin/dsoffice')) continue;
   const columns=row.trim().split(/\s+/);
   const [pid,parent,elapsed,cpu,rss]=columns;
   const parts=elapsed.split(':').map(Number);
   const seconds=parts.reduce((sum,value)=>sum*60+value,0);
   if(seconds<30||sampled.has(pid)) continue;
   sampled.add(pid);
   console.log(JSON.stringify({event:'slow-office-helper',pid,parent,elapsed,cpu,rss}));
   try{
    const sample=execFileSync('/usr/bin/sample',[pid,'2','1'],{encoding:'utf8',timeout:15000,maxBuffer:4*1024*1024});
    console.log(sample.slice(0,100000));
   }catch(error){console.log('Office helper sampling unavailable:',error.code);}
  }
 }catch(error){console.log('Office process diagnostic unavailable:',error.code);}
},15000);
