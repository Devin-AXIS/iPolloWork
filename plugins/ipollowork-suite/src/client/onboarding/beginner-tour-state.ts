/** Resumable, device-local tutorial preferences; no conversation or model actions. */
import {createSnapshotStore} from '@deepseek-ai/dsh-client-store'
import type {ConfigForm} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {OnboardingSettings} from './settings.ts'
export const lastTutorialStep=8
type Status=NonNullable<OnboardingSettings['tutorialStatus']>
export interface TutorialState {active:boolean;index:number;pending:boolean;error:boolean;status:Status;available:boolean}
export class BeginnerTourController {
  readonly state=createSnapshotStore<TutorialState>({active:false,index:0,pending:false,error:false,status:'never',available:false})
  private readonly unsubscribe:()=>void
  private disposed=false
  private hidden=false
  private failed:{status:Status;index:number}|undefined
  constructor(private readonly form:ConfigForm<OnboardingSettings>){this.unsubscribe=form.subscribe(()=>this.derive());this.derive()}
  private derive(){
    if(this.disposed)return
    const host=this.form.getSnapshot(),current=this.state.getSnapshot(),status=host.value?.tutorialStatus??'never'
    const index=Math.max(0,Math.min(lastTutorialStep,Math.floor(host.value?.tutorialStep??0)))
    const available=host.status==='ready'&&host.writable
    this.state.set({...current,active:status==='active'&&!this.hidden&&available,status,index,available})
  }
  async go(status:Status,index:number):Promise<boolean>{
    if(this.disposed||this.state.getSnapshot().pending)return false
    const desired={status,index:Math.max(0,Math.min(lastTutorialStep,Math.floor(index)))}
    if(status==='active')this.hidden=false
    this.state.set({...this.state.getSnapshot(),pending:true,error:false})
    try{
      if(!this.state.getSnapshot().available)throw new Error('Tutorial settings unavailable')
      const accepted=await this.form.mutate([{op:'set',path:['tutorialStatus'],value:status},{op:'set',path:['tutorialStep'],value:desired.index}])
      const saved=this.form.getSnapshot().value
      if(!accepted||saved?.tutorialStatus!==status||saved.tutorialStep!==desired.index)throw new Error('Tutorial preferences were not saved')
      this.failed=undefined;this.derive();return !this.disposed
    }catch{
      this.failed=desired
      if(!this.disposed)this.state.set({...this.state.getSnapshot(),error:true})
      return false
    }finally{if(!this.disposed)this.state.set({...this.state.getSnapshot(),pending:false})}
  }
  start=()=>this.go('active',0)
  next=()=>{const index=this.state.getSnapshot().index;return this.go(index===lastTutorialStep?'done':'active',Math.min(lastTutorialStep,index+1))}
  back=()=>this.go('active',this.state.getSnapshot().index-1)
  skip=()=>this.go('skipped',this.state.getSnapshot().index)
  retry=()=>this.failed?this.go(this.failed.status,this.failed.index):Promise.resolve(false)
  dismiss=()=>{this.hidden=true;if(!this.disposed)this.state.set({...this.state.getSnapshot(),active:false})}
  dispose(){this.disposed=true;this.unsubscribe()}
}
