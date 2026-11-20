/** Run the unmodified 093bd559 Host assertions against its already compiled, sealed SDK. */
import {isBuiltin,registerHooks} from 'node:module';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';

const [source,root,resources]=process.argv.slice(2).map(path=>resolve(path));
assert.equal(process.env.GITHUB_ACTIONS,'true');
const prefix=pathToFileURL(source+'/').href;
const sdk=pathToFileURL(join(root,'package.json')).href;
const hooks=registerHooks({resolve(specifier,context,next){
 if(context.parentURL?.startsWith(prefix)){
  if(specifier==='../../../packages/skill/tool-workspace-dependencies/src/index.ts') return next('@deepseek-ai/dsh-tool-workspace-dependencies',{...context,parentURL:sdk});
  if(!isBuiltin(specifier)&&!specifier.startsWith('.')&&!specifier.startsWith('/')&&!specifier.startsWith('file:')) return next(specifier,{...context,parentURL:sdk});
 }
 return next(specifier,context);
}});
try{
 const {readDesktopRuntime}=await import(pathToFileURL(join(source,'integrations/desktop/src/runtime-tree.ts')).href);
 const {smokeDesktopRuntime}=await import(pathToFileURL(join(source,'integrations/desktop/scripts/smoke-runtime.ts')).href);
 await smokeDesktopRuntime(root,process.execPath,readDesktopRuntime(root),process.env,resources);
}finally{hooks.deregister();}
