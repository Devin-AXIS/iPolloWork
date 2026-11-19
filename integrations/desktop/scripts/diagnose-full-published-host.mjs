import {isBuiltin,registerHooks} from 'node:module';
import {mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';

const [root,resourcesRuntime]=process.argv.slice(2).map(path=>resolve(path));
const repository=new URL('../../../',import.meta.url).href;
const sdk=pathToFileURL(join(root,'package.json')).href;
const hooks=registerHooks({resolve(specifier,context,next){
 if(context.parentURL?.startsWith(repository)&&!isBuiltin(specifier)&&!specifier.startsWith('.')&&!specifier.startsWith('/')&&!specifier.startsWith('file:')) return next(specifier,{...context,parentURL:sdk});
 return next(specifier,context);
}});
const fixture=new URL('./.diagnostic-smoke-runtime.ts',import.meta.url);
const cache=mkdtempSync(join(tmpdir(),'published-host-native-cache-'));
try{
 const source=readFileSync(new URL('./smoke-runtime.ts',import.meta.url),'utf8')
  .replace('../../../packages/skill/tool-workspace-dependencies/src/index.ts','@deepseek-ai/dsh-tool-workspace-dependencies');
 const start=source.indexOf('    if (dedicatedSuite) {');
 const end=source.indexOf('    const pluginResponse = ',start);
 if(start<0||end<0) throw Error('Could not locate the newer Suite assertions in the baseline fixture');
 // The older release keeps its real Host and Suite composition. This diagnostic
 // compares Office, not features that may have been added after that release.
 writeFileSync(fixture,source.slice(0,start)+source.slice(end));
 const {readDesktopRuntime}=await import('../src/runtime-tree.ts');
 const {smokeDesktopRuntime}=await import(fixture.href);
 console.log(JSON.stringify({event:'published-full-host-begin',root,arch:process.arch,time:new Date().toISOString()}));
 await smokeDesktopRuntime(root,process.execPath,readDesktopRuntime(root),{...process.env,NARB_NATIVE_CACHE_DIR:cache,NARB_DISABLE_NATIVE_CACHE:'0'},resourcesRuntime);
 console.log(JSON.stringify({event:'published-full-host-passed',time:new Date().toISOString()}));
}finally{
 hooks.deregister();
 await rm(fileURLToPath(fixture),{force:true});
 await rm(cache,{recursive:true,force:true});
}
