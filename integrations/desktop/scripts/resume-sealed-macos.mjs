/** Complete an unchanged sealed application with its original Host assertions and Apple checks. */
import assert from 'node:assert/strict';
import {spawn,execFile,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createReadStream} from 'node:fs';
import {mkdtemp,rm} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {tmpdir} from 'node:os';
import {promisify} from 'node:util';
import {pathToFileURL,fileURLToPath} from 'node:url';

const commit=process.env.EXPECTED_COMMIT;
assert.match(commit??'',/^[a-f0-9]{40}$/);
const tag=process.env.RELEASE_TAG;
assert.match(tag??'',/^v[0-9]+\.[0-9]+\.[0-9]+$/);
const version=tag.slice(1);
assert.equal(process.platform,'darwin');
const arch=process.env.PACKAGE_TARGET==='mac-arm64'?'arm64':'x64';
assert.equal(process.arch,arch);
const targetName='mac-'+arch;
const subdirectory=arch==='arm64'?'mac-arm64':'mac';
assert.equal(process.env.GITHUB_ACTIONS,'true');
const source=process.cwd();
const original=join(process.env.RUNNER_TEMP,'retained/iPollo.app');
const require=createRequire(join(source,'integrations/desktop/package.json'));
const module=path=>import(pathToFileURL(join(source,path)).href);
const {readDesktopBuildCommit,desktopBuildCommitEnvironment}=await module('integrations/desktop/scripts/desktop-build-commit.mjs');
assert.deepEqual(readDesktopBuildCommit(source),{commit,dirty:false});
const {loadDesktopPackageEnvironment}=await module('integrations/desktop/scripts/desktop-package-environment.mjs');
const environment={...process.env,...loadDesktopPackageEnvironment('darwin'),
 DSH_DESKTOP_TARGET:targetName,DSH_DESKTOP_TARGET_PLATFORM:'darwin',DSH_DESKTOP_TARGET_ARCH:arch,
 DSH_DESKTOP_BUILD_VERSION:version,...desktopBuildCommitEnvironment({commit,dirty:false})};
Object.assign(process.env,environment);
const {readAsar}=require('app-builder-lib/out/asar/asar.js');
const archive=await readAsar(join(original,'Contents/Resources/app.asar'));
const metadata=JSON.parse((await archive.readFile('package.json')).toString());
assert.equal(metadata.version,version);
assert.equal(metadata.dshBuildCommit,commit);
assert.equal(metadata.dshBuildDirty,false);
const descriptor=JSON.parse((await archive.readFile('dsh/desktop-runtime.json')).toString());
assert.equal(descriptor.platform,'darwin');
assert.equal(descriptor.arch,arch);
assert.equal(descriptor.release.version,JSON.parse(readFileSync('integrations/runtime/upstream.json','utf8')).npmVersion);
const {resolveDesktopTargetBuildPaths}=await module('integrations/desktop/scripts/desktop-build-paths.mjs');
const paths=resolveDesktopTargetBuildPaths();
mkdirSync(join(paths.artifacts,subdirectory),{recursive:true});
const app=join(paths.artifacts,subdirectory,'iPollo.app');
execFileSync('/usr/bin/ditto',[original,app],{stdio:'inherit'});
const {resolveMacOSSigningEnvironment}=await module('integrations/desktop/scripts/desktop-release-environment.mjs');
const {verifyMacOSSignature}=await module('integrations/desktop/scripts/verify-macos-signature.mjs');
verifyMacOSSignature(app,resolveMacOSSigningEnvironment(environment));
const {verifyRuntimeArchive}=await module('integrations/desktop/scripts/verify-runtime-archive.ts');
const {desktopNodeEnvironment}=await module('integrations/desktop/src/node-environment.ts');
const {scrubWindowsSigningEnvironment}=await module('integrations/desktop/scripts/windows-sign.mjs');
for(let iteration=1;iteration<=2;iteration++){
 console.log(JSON.stringify({event:'sealed-runtime-full-smoke-begin',commit,version,iteration}));
 await verifyRuntimeArchive(join(app,'Contents/Resources/app.asar'),descriptor);
 const executable=join(app,'Contents/MacOS/iPollo');
 const resources=join(app,'Contents/Resources/runtime');
 const root=join(app,'Contents/Resources/app.asar/dsh');
 const cache=await mkdtemp(join(tmpdir(),'sealed-runtime-native-'));
 const env=desktopNodeEnvironment(executable,join(resources,'bin'),{...scrubWindowsSigningEnvironment(environment),
  NODE_OPTIONS:'',NARB_NATIVE_CACHE_DIR:cache,NARB_DISABLE_NATIVE_CACHE:'0'});
 try{
  const payload=await promisify(execFile)(executable,['--expose-internals',join(source,'integrations/desktop/tests/fixtures/runtime-payload-smoke.mjs'),root,resources],
   {env,timeout:120000,maxBuffer:8*1024*1024});
  process.stdout.write(payload.stdout);
  const host=await promisify(execFile)(executable,['--expose-internals','--experimental-transform-types',fileURLToPath(new URL('./check-sealed-desktop-host.mjs',import.meta.url)),source,root,resources],
   {env,timeout:600000,maxBuffer:8*1024*1024});
  process.stdout.write(host.stdout);
 }catch(error){
  if(typeof error.stdout==='string')process.stdout.write(error.stdout);
  if(typeof error.stderr==='string')process.stderr.write(error.stderr);
  throw error;
 }finally{await rm(cache,{recursive:true,force:true});}
 console.log(JSON.stringify({event:'sealed-runtime-full-smoke-passed',iteration}));
}
const {withMacOSSigningKeychain}=await module('integrations/desktop/scripts/macos-signing-keychain.mjs');
const {packageMacOSArtifacts}=await module('integrations/desktop/scripts/package-macos.ts');
const {desktopElectronBuilderArguments,resolveDesktopPackageTarget}=await module('integrations/desktop/scripts/package-target.ts');
const {resolveMacOSPackageSettings}=await module('integrations/desktop/scripts/macos-package-settings.mjs');
const mac=resolveMacOSPackageSettings(environment);
const target=resolveDesktopPackageTarget(targetName);
await withMacOSSigningKeychain(environment,async signed=>{
 await packageMacOSArtifacts({arch,version,artifactsRoot:paths.artifacts,environment:signed},artifact=>new Promise((done,fail)=>{
  const child=spawn(process.execPath,[join(source,'node_modules/pnpm/bin/pnpm.cjs'),'--config.verify-deps-before-run=false',
   ...desktopElectronBuilderArguments(target,false,artifact)],{
   cwd:join(source,'integrations/desktop'),stdio:'inherit',
   env:{...signed,...(artifact.format==='zip'?{ELECTRON_BUILDER_COMPRESSION_LEVEL:String(mac.zipCompressionLevel)}:{})}});
  child.once('error',fail);
  child.once('close',(code,signal)=>code===0?done():fail(new Error(`Artifact packaging exited ${code??signal}`)));
 }));
});
// This record describes the sealed App's verified metadata, never the diagnostic workflow commit.
const {resolveDesktopAutoUpdateConfig}=require('@deepseek-ai/dsh-desktop-publisher/desktop-auto-update-environment.mjs');
const update=resolveDesktopAutoUpdateConfig(environment,'darwin',arch);
assert.equal(update.environment,'production');
assert.equal(update.channel,'stable');
assert.equal(update.publicUrl,'https://github.com/Devin-AXIS/iPolloWork/releases/latest/download/');
writeFileSync(join(paths.artifacts,targetName+'-release.json'),JSON.stringify({schemaVersion:1,target:targetName,version,
 environment:update.environment,channel:update.channel,publicUrl:update.publicUrl,commit:metadata.dshBuildCommit,dirty:metadata.dshBuildDirty},null,2)+'\n');
const hash=createHash('sha256');
for await(const chunk of createReadStream(join(process.env.RUNNER_TEMP,'retained/application.zip'))) hash.update(chunk);
writeFileSync(join(paths.artifacts,'resume-provenance.json'),JSON.stringify({sourceCommit:commit,version,
 retainedBuildRun:Number(process.env.RETAINED_RUN),retainedArtifactId:Number(process.env.RETAINED_ARTIFACT_ID),retainedApplicationSha256:hash.digest('hex'),
 workflowCommit:process.env.GITHUB_SHA,fullRuntimeSmokePasses:2,signingAndNotarization:'verified'},null,2)+'\n');
console.log(JSON.stringify({event:'sealed-runtime-release-ready',commit,version,artifacts:paths.artifacts}));
