/** Resume the sealed 093bd559 application on a clean CI host, retaining all payload and Apple checks. */
import assert from 'node:assert/strict';
import {spawn,execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {createReadStream} from 'node:fs';
import {createRequire} from 'node:module';
import {resolve,join} from 'node:path';
import {pathToFileURL} from 'node:url';

const commit='093bd559ed0d290cfe787287e01a241b45deaa08';
const version='1.0.8';
assert.equal(process.platform,'darwin');
assert.equal(process.arch,'x64');
assert.equal(process.env.GITHUB_ACTIONS,'true');
const source=process.cwd();
const original=join(process.env.RUNNER_TEMP,'retained/iPollo.app');
const require=createRequire(join(source,'integrations/desktop/package.json'));
const module=path=>import(pathToFileURL(join(source,path)).href);
const {readDesktopBuildCommit,desktopBuildCommitEnvironment}=await module('integrations/desktop/scripts/desktop-build-commit.mjs');
assert.deepEqual(readDesktopBuildCommit(source),{commit,dirty:false});
const {loadDesktopPackageEnvironment}=await module('integrations/desktop/scripts/desktop-package-environment.mjs');
const environment={...process.env,...loadDesktopPackageEnvironment('darwin'),
 DSH_DESKTOP_TARGET:'mac-x64',DSH_DESKTOP_TARGET_PLATFORM:'darwin',DSH_DESKTOP_TARGET_ARCH:'x64',
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
assert.equal(descriptor.arch,'x64');
assert.equal(descriptor.release.version,JSON.parse(readFileSync('integrations/runtime/upstream.json','utf8')).npmVersion);
const {resolveDesktopTargetBuildPaths}=await module('integrations/desktop/scripts/desktop-build-paths.mjs');
const paths=resolveDesktopTargetBuildPaths();
mkdirSync(join(paths.artifacts,'mac'),{recursive:true});
const app=join(paths.artifacts,'mac/iPollo.app');
execFileSync('/usr/bin/ditto',[original,app],{stdio:'inherit'});
const {resolveMacOSSigningEnvironment}=await module('integrations/desktop/scripts/desktop-release-environment.mjs');
const {verifyMacOSSignature}=await module('integrations/desktop/scripts/verify-macos-signature.mjs');
verifyMacOSSignature(app,resolveMacOSSigningEnvironment(environment));
const {smokePreparedRuntime}=await module('integrations/desktop/scripts/smoke-prepared-runtime.ts');
for(let iteration=1;iteration<=2;iteration++){
 console.log(JSON.stringify({event:'sealed-runtime-full-smoke-begin',commit,version,iteration}));
 await smokePreparedRuntime(join(app,'Contents/Resources/app.asar/dsh'),join(app,'Contents/MacOS/iPollo'),join(app,'Contents/Resources/runtime'),descriptor);
 console.log(JSON.stringify({event:'sealed-runtime-full-smoke-passed',iteration}));
}
const {withMacOSSigningKeychain}=await module('integrations/desktop/scripts/macos-signing-keychain.mjs');
const {packageMacOSArtifacts}=await module('integrations/desktop/scripts/package-macos.ts');
const {desktopElectronBuilderArguments,resolveDesktopPackageTarget}=await module('integrations/desktop/scripts/package-target.ts');
const {resolveMacOSPackageSettings}=await module('integrations/desktop/scripts/macos-package-settings.mjs');
const mac=resolveMacOSPackageSettings(environment);
const target=resolveDesktopPackageTarget('mac-x64');
await withMacOSSigningKeychain(environment,async signed=>{
 await packageMacOSArtifacts({arch:'x64',version,artifactsRoot:paths.artifacts,environment:signed},artifact=>new Promise((done,fail)=>{
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
const update=resolveDesktopAutoUpdateConfig(environment,'darwin','x64');
assert.equal(update.environment,'production');
assert.equal(update.channel,'stable');
assert.equal(update.publicUrl,'https://github.com/Devin-AXIS/iPolloWork/releases/latest/download/');
writeFileSync(join(paths.artifacts,'mac-x64-release.json'),JSON.stringify({schemaVersion:1,target:'mac-x64',version,
 environment:update.environment,channel:update.channel,publicUrl:update.publicUrl,commit:metadata.dshBuildCommit,dirty:metadata.dshBuildDirty},null,2)+'\n');
const hash=createHash('sha256');
for await(const chunk of createReadStream(join(process.env.RUNNER_TEMP,'retained/application.zip'))) hash.update(chunk);
writeFileSync(join(paths.artifacts,'resume-provenance.json'),JSON.stringify({sourceCommit:commit,version,
 retainedBuildRun:44562262558,retainedArtifactId:14551679282,retainedApplicationSha256:hash.digest('hex'),
 workflowCommit:process.env.GITHUB_SHA,fullRuntimeSmokePasses:2,signingAndNotarization:'verified'},null,2)+'\n');
console.log(JSON.stringify({event:'sealed-runtime-release-ready',commit,version,artifacts:paths.artifacts}));
