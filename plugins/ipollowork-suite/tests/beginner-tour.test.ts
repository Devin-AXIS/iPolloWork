import test from 'node:test'
import assert from 'node:assert/strict'
import {createSnapshotStore} from '@deepseek-ai/dsh-client-store'
import type {ConfigForm,ConfigFormSnapshot} from '@deepseek-ai/dsh-client-ui-settings/client'
import {BeginnerTourController,lastTutorialStep} from '../src/client/onboarding/beginner-tour-state.ts'
import {tutorialSteps} from '../src/client/onboarding/beginner-tour-copy.ts'
import {OnboardingSettingsSchema,type OnboardingSettings} from '../src/client/onboarding/settings.ts'
function fixture(){
  const value=OnboardingSettingsSchema({step:'done',purpose:'office',process:'compact',completion:'completed'})
  const store=createSnapshotStore<ConfigFormSnapshot<OnboardingSettings>>({status:'ready',value,base:value,user:{},revision:0,writable:true})
  let refused=false;const writes:string[][]=[]
  const form={getSnapshot:store.getSnapshot,subscribe:store.subscribe,async mutate(ops:Parameters<ConfigForm<OnboardingSettings>['mutate']>[0]){
    if(refused)return false
    const next={...store.getSnapshot().value} as OnboardingSettings
    const paths:string[]=[]
    for(const op of ops){assert.equal(op.op,'set');assert.equal(op.path.length,1);if(op.op==='set'){const key=String(op.path[0]);assert(['tutorialStatus','tutorialStep'].includes(key));Reflect.set(next,key,op.value);paths.push(key)}}
    writes.push(paths);store.set({...store.getSnapshot(),value:next});return true
  }} as ConfigForm<OnboardingSettings>
  return {form,store,writes,refuse:(value:boolean)=>{refused=value}}
}
test('existing setup choices are preserved while tutorials resume, skip and restart',async()=>{
  const f=fixture();let guide=new BeginnerTourController(f.form)
  assert.equal(guide.state.getSnapshot().active,false,'an existing installation is not forced into a new tutorial')
  assert.equal(await guide.start(),true);await guide.next();await guide.next();guide.dispose()
  guide=new BeginnerTourController(f.form);assert.equal(guide.state.getSnapshot().index,2);assert.equal(guide.state.getSnapshot().active,true)
  await guide.skip();assert.equal(guide.state.getSnapshot().active,false);assert.equal(f.store.getSnapshot().value?.tutorialStatus,'skipped')
  await guide.start();assert.equal(guide.state.getSnapshot().index,0)
  for(let i=0;i<=lastTutorialStep;i++)await guide.next()
  assert.equal(guide.state.getSnapshot().status,'done');assert.equal(guide.state.getSnapshot().active,false)
  assert.equal(f.store.getSnapshot().value?.step,'done');assert.equal(f.store.getSnapshot().value?.purpose,'office');assert.equal(f.store.getSnapshot().value?.process,'compact')
  assert.equal(tutorialSteps.length,lastTutorialStep+1);guide.dispose()
})
test('refused progress writes retain the current step, allow retry and never prevent local dismissal',async()=>{
  const f=fixture(),guide=new BeginnerTourController(f.form);await guide.start();f.refuse(true)
  assert.equal(await guide.next(),false);assert.equal(guide.state.getSnapshot().index,0);assert.equal(guide.state.getSnapshot().error,true)
  guide.dismiss();assert.equal(guide.state.getSnapshot().active,false);assert.equal(f.store.getSnapshot().value?.tutorialStatus,'active')
  f.refuse(false);assert.equal(await guide.retry(),true);assert.equal(guide.state.getSnapshot().index,1);assert.equal(guide.state.getSnapshot().active,true)
  guide.dispose();const count=f.writes.length;assert.equal(await guide.start(),false);assert.equal(f.writes.length,count)
})
test('read-only onboarding preferences do not open a tutorial that cannot save progress',async()=>{
  const f=fixture();f.store.set({...f.store.getSnapshot(),writable:false})
  const guide=new BeginnerTourController(f.form);assert.equal(await guide.start(),false);assert.equal(f.writes.length,0);assert.equal(guide.state.getSnapshot().active,false);guide.dispose()
})

test('closing during an acknowledged progress write stays closed when that write completes',async()=>{
  const f=fixture(),guide=new BeginnerTourController(f.form);await guide.start()
  const mutate=f.form.mutate.bind(f.form);let release!:()=>void
  const acknowledgement=new Promise<void>(resolve=>{release=resolve})
  f.form.mutate=async ops=>{const accepted=await mutate(ops);await acknowledgement;return accepted}
  const saving=guide.next()
  assert.equal(guide.state.getSnapshot().index,1);assert.equal(guide.state.getSnapshot().pending,true)
  guide.dismiss();release();assert.equal(await saving,true)
  assert.equal(guide.state.getSnapshot().active,false,'late native acknowledgement must not reopen a dismissed guide')
  f.store.set({...f.store.getSnapshot()});assert.equal(guide.state.getSnapshot().active,false)
  assert.equal(await guide.go('active',1),true);assert.equal(guide.state.getSnapshot().active,true)
  guide.dispose()
})
