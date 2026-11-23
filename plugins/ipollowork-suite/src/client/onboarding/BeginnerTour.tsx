/** Guided reading of real controls; locating a control never clicks or submits it. */
import {useEffect,useLayoutEffect,useRef,useState,useSyncExternalStore} from 'react'
import {createPortal} from 'react-dom'
import {Button} from '@deepseek-ai/dsh-client-ui-primitives'
import type {ClientContext} from '../native.ts'
import {language} from '../locale.ts'
import {BeginnerTourController,lastTutorialStep,type TutorialState} from './beginner-tour-state.ts'
import {tutorialCopy,tutorialSteps} from './beginner-tour-copy.ts'
import type {OnboardingSettings} from './settings.ts'
import css from './BeginnerTour.module.css'

type Bounds={x:number;y:number;width:number;height:number}
export function tutorialTarget(index:number,root:Document=document):HTMLElement|null{
  const step=tutorialSteps[index]
  if(!step)return null
  const visible=(element:HTMLElement)=>{const box=element.getBoundingClientRect();return box.width>0&&box.height>0&&!element.closest('[data-beginner-tour]')}
  if('selector'in step){const element=root.querySelector<HTMLElement>(step.selector);if(element&&visible(element))return element}
  if(!('labels'in step))return null
  const candidates=[...root.querySelectorAll<HTMLElement>('button,a,[role="button"],[role="tab"]')].filter(visible)
  const matches=(label:string|null)=>Boolean(label&&step.labels.test(label.trim()))
  return candidates.find(element=>matches(element.textContent))??candidates.find(element=>matches(element.getAttribute('aria-label'))||matches(element.title))??null
}
export function BeginnerTour({state,controller,locale}:{state:TutorialState;controller:Pick<BeginnerTourController,'next'|'back'|'skip'|'retry'|'dismiss'>;locale:string}){
  const lang=locale==='zh'?'zh':'en',t=tutorialCopy[lang],step=tutorialSteps[state.index]
  const card=useRef<HTMLElement>(null),next=useRef<HTMLButtonElement>(null)
  const [anchor,setAnchor]=useState<Bounds|null>(null),[position,setPosition]=useState({left:12,top:60})
  useEffect(()=>{
    if(!state.active)return
    const previous=document.activeElement
    return ()=>{if(previous instanceof HTMLElement&&previous.isConnected)previous.focus({preventScroll:true})}
  },[state.active])
  useLayoutEffect(()=>{if(state.active)next.current?.focus()},[state.active,state.index])
  useLayoutEffect(()=>{
    if(!state.active)return
    let frame=0
    const measure=()=>{
      frame=0
      const target=tutorialTarget(state.index),box=target?.getBoundingClientRect(),own=card.current?.getBoundingClientRect()
      const visible=box&&box.bottom>0&&box.top<window.innerHeight&&box.right>0&&box.left<window.innerWidth
      const bounds=visible?{x:box.x,y:box.y,width:box.width,height:box.height}:null
      setAnchor(current=>JSON.stringify(current)===JSON.stringify(bounds)?current:bounds)
      const width=own?.width??360,height=own?.height??300
      const left=Math.max(12,Math.min(window.innerWidth-width-12,bounds?bounds.x:(window.innerWidth-width)/2))
      const ideal=bounds?(bounds.y+bounds.height+height+24<window.innerHeight?bounds.y+bounds.height+12:bounds.y-height-12):(window.innerHeight-height)/2
      const clearance=parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--dsh-frame-top-clearance'))||0
      const top=Math.max(clearance+12,Math.min(window.innerHeight-height-12,ideal))
      setPosition(current=>current.left===left&&current.top===top?current:{left,top})
    }
    const schedule=()=>{if(!frame)frame=requestAnimationFrame(measure)}
    const observer=new MutationObserver(schedule);observer.observe(document.body,{childList:true,subtree:true})
    const resize=new ResizeObserver(schedule);if(card.current)resize.observe(card.current)
    window.addEventListener('resize',schedule);window.addEventListener('scroll',schedule,true);measure()
    return ()=>{observer.disconnect();resize.disconnect();cancelAnimationFrame(frame);window.removeEventListener('resize',schedule);window.removeEventListener('scroll',schedule,true)}
  },[state.active,state.index,locale])
  if(!state.active||!step)return null
  const locate=()=>{const target=tutorialTarget(state.index);target?.scrollIntoView({block:'nearest',inline:'nearest'});target?.focus({preventScroll:true})}
  return createPortal(<div className={css.tour} data-beginner-tour>
    {anchor&&<div className={css.spotlight} aria-hidden="true" style={{left:anchor.x-3,top:anchor.y-3,width:anchor.width+6,height:anchor.height+6}}/>}
    <section ref={card} className={css.card} style={position} role="dialog" aria-modal="false" aria-labelledby="ipw-tutorial-title" aria-describedby="ipw-tutorial-description"
      onKeyDown={event=>{if(event.key==='Escape'){event.preventDefault();event.stopPropagation();controller.dismiss()}}}>
      <header><span>{t.title}</span><span aria-live="polite">{state.index+1} / {tutorialSteps.length}</span><button type="button" className={css.close} aria-label={lang==='zh'?'暂时关闭教程':'Close tutorial for now'} onClick={controller.dismiss}>×</button></header>
      <progress aria-label={t.progress} max={tutorialSteps.length} value={state.index+1}/>
      <h2 id="ipw-tutorial-title">{step[lang][0]}</h2>
      <p id="ipw-tutorial-description">{step[lang][1]}</p>
      {'labels'in step&&(anchor?<button className={css.locate} type="button" onClick={locate}>{t.open}</button>:<p className={css.muted}>{t.missing}</p>)}
      {state.error&&<div className={css.error} role="alert">{t.failed}<button type="button" disabled={state.pending} onClick={()=>{void controller.retry()}}>{t.retry}</button></div>}
      <footer><button type="button" className={css.skip} disabled={state.pending} onClick={()=>{void controller.skip()}}>{t.skip}</button><div>
        {state.index>0&&<Button disabled={state.pending} onClick={()=>{void controller.back()}}>{t.back}</Button>}
        <Button ref={next} variant="primary" disabled={state.pending} onClick={()=>{void controller.next()}}>{state.index===lastTutorialStep?t.done:state.index===0?t.start:t.next}</Button>
      </div></footer>
    </section>
  </div>,document.body)
}

/** The ordinary settings section receives the native leave action, avoiding modal DOM workarounds. */
export function mountBeginnerTour(ctx:ClientContext){
  const controller=new BeginnerTourController(ctx.configForms.get<OnboardingSettings>('ipollowork-onboarding'))
  const useLanguage=()=>useSyncExternalStore(listener=>ctx.locale.subscribe(listener),()=>language(ctx))
  const useTutorial=()=>useSyncExternalStore(controller.state.subscribe,controller.state.getSnapshot)
  ctx.effect(()=>()=>controller.dispose(),'ipollowork-suite: beginner tutorial')
  ctx.slots.inject('shell.overlay',()=>ctx.slots.register({name:'shell.overlay',id:'ipollowork-beginner-tour'},function TutorialOverlay(){
    return <BeginnerTour state={useTutorial()} controller={controller} locale={useLanguage()}/>
  }))
  ctx.slots.inject('settings.section',()=>ctx.slots.register({name:'settings.section',id:'ipollowork-tutorial',order:-15,label:()=>tutorialCopy[language(ctx)==='zh'?'zh':'en'].title},function TutorialSettings({close}:{close:()=>void}){
    const state=useTutorial(),lang=useLanguage()==='zh'?'zh':'en',t=tutorialCopy[lang]
    const start=async(index:number)=>{if(await controller.go('active',index))close()}
    return <section className={css.settings}><h2>{t.title}</h2><p>{t.intro}</p><ol>{tutorialSteps.slice(1,-1).map((step,index)=><li key={index}>{step[lang][0]}</li>)}</ol>
      {state.error&&<p role="alert" className={css.error}>{t.failed}</p>}
      <div className={css.actions}>{state.index>0&&state.status!=='done'&&<Button disabled={state.pending||!state.available} onClick={()=>{void start(state.index)}}>{t.resume}</Button>}
        <Button variant="primary" disabled={state.pending||!state.available} onClick={()=>{void start(0)}}>{state.status==='never'?t.start:t.again}</Button></div>
    </section>
  }))
  return controller
}
