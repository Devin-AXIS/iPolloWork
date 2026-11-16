import test from 'node:test';
import assert from 'node:assert/strict';
import { brandString } from '@deepseek-ai/dsh-brand';
import type { ModelSelection } from '@deepseek-ai/dsh-agent';
import type { SettingsNamespace } from '@deepseek-ai/dsh-settings';
import type { ModelCatalog } from '@deepseek-ai/dsh-api-session-controller/types';
import { initializeAccountModel, type DefaultModelServices } from '../src/host/default-model.ts';

function fixture() {
  let selection: ModelSelection = { provider:'deepseek', model:'original' };
  let configured = false;
  let reads = 0;
  let groups: ModelCatalog['groups'] = [{id:'ipollo-channel',name:'Channel',models:[{id:'account-model',name:'Account model',reasoning:{efforts:[],defaultEffort:'high'}}]}];
  const saves: ModelSelection[] = [];
  const refs: string[] = [];
  const services: DefaultModelServices = {
    llm: { listConfigurableProviders:()=>[{provider:'personal',displayName:'Personal',settingsNs:'personal',settingsPath:['connection']}] },
    settings: {describe:()=>[{ns:brandString<SettingsNamespace>('personal'),autoGenerate:false,schema:{},value:{connection:{apiKeyEnv:'PERSONAL_API_KEY'}},revision:0,applies:'live'}]},
    credentials: {describe:async ref=>{refs.push(ref);return {configured,writable:true,...(configured?{source:'env'}:{})}}},
    agentDefaultModel: { currentSelection:()=>selection, saveSelection:async next=>{selection=next;saves.push(next)} },
    sessionController: {modelCatalog:async()=>{reads++;return {default:selection,routableProviders:groups.map(g=>g.id),groups,failures:[]}}},
  };
  return {services,saves,refs,get reads(){return reads},setConfigured:(value:boolean)=>{configured=value},setSelection:(value:ModelSelection)=>{selection=value},clearModels:()=>{groups=[]}};
}

test('account default uses public DSH saveSelection with its model reasoning default',async()=>{
 const f=fixture();await initializeAccountModel(f.services,['ipollo-channel']);
 assert.deepEqual(f.saves,[{provider:'ipollo-channel',model:'account-model',reasoningEffort:'high'}]);
 assert.deepEqual(f.refs,['PERSONAL_API_KEY']);
});
test('configured personal keys and an existing account choice are never overwritten',async()=>{
 const f=fixture();f.setConfigured(true);await initializeAccountModel(f.services,['ipollo-channel']);assert.equal(f.saves.length,0);assert.equal(f.reads,0);
 f.setConfigured(false);f.setSelection({provider:'ipollo-channel',model:'chosen-by-user'});await initializeAccountModel(f.services,['ipollo-channel']);assert.equal(f.saves.length,0);assert.equal(f.reads,0);
});
test('no account route retains the default and unavailable routes fail without saving',async()=>{
 const f=fixture();await initializeAccountModel(f.services,[]);assert.equal(f.reads,0);
 f.clearModels();await assert.rejects(initializeAccountModel(f.services,['ipollo-channel']),{code:'session/provider-models-unavailable',message:'provider "ipollo-channel" has no available models'});assert.equal(f.saves.length,0);
});

test('cloud defaults ignore personal key configuration and select an account model',async()=>{
 const f=fixture();f.setConfigured(true);await initializeAccountModel(f.services,['ipollo-channel'],true);
 assert.equal(f.saves[0]?.provider,'ipollo-channel');assert.deepEqual(f.refs,[]);
});
