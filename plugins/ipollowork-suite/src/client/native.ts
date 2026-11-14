/** Minimal public DSH client capabilities consumed by the suite. */
import type { ComponentType } from 'react'
export interface NativeSessionBinding { readonly sessionId:string; readonly ctx:object }
/** Credential-free result supplied to the optional native sharing hook. */
interface SharingPreparation { readonly connected?:boolean; readonly error?:string }
export interface SlotOptions<P> {
  name: string; locale?: string; id?: string; key?: string; order?: number; priority?: number; label?: () => string;
  inject?: () => Record<string, unknown>;
}
export interface ClientContext {
  configForms: import('@deepseek-ai/dsh-client-ui-settings/client').ConfigForms;
  provide(name: 'ipolloConnections', value: import('../shared/connections.ts').ConnectionManager): void;
  provide(name: 'ipolloData', value: import('../shared/app-data.ts').IpolloData): void;
  effect(effect: () => void | (() => void), label?: string): unknown;
  slots: {
    inject(name: string, install: () => void | (() => void) | Iterable<() => void>): unknown;
    register<P>(options: SlotOptions<P>, component: ComponentType<P>): () => void;
  };
  theme: { overrideTokens(source: string, tokens: Record<string, { light: string; dark: string }>): () => void };
  locale: { getSnapshot(): { active?: string; locale?: string; language?: string } | string; subscribe(listener: () => void): () => void };
  remote: { $on(event: string, listener: () => void): () => void };
  on(name: string, listener: () => void): () => void;
  on(name: 'liveshare/prepare-owner', listener: (signal: AbortSignal, next: () => Promise<SharingPreparation>) => Promise<SharingPreparation>): () => void;
  layout: { selectPanel(id: string): void };
  uiWorkspace: {
    openSession(sessionId: string): void;
    openWorkspace(workspaceId: string): Promise<void>;
    pickDirectory(): Promise<string | null>;
    listDirectory(path?:string,signal?:AbortSignal): Promise<{
      path:string;home:string;entries:{name:string;path:string;hidden:boolean}[];crumbs:{name:string;path:string}[];truncated:boolean;
    }>;
    createDirectory(path:string,name:string):Promise<string>;
  };
  workspaces: { create(input:{path:string}):Promise<{workspaceId:string;path:string;title:string}>; list: {
    getSnapshot(): { phase: 'pending' | 'ready'; items: readonly { workspaceId:string;title:string;path:string;sessionIds:readonly string[] }[] };
    subscribe(listener:()=>void):()=>void;
  } };
  contextMenus: { register(contribution:{
    id:string;target:'workspace'|'session'|'sessionHeader';order:number;
    resolve(input:{workspaceId?:string;sessionId?:string;displayTitle?:string}):{id:string;label:string;icon?:{key:string};run:()=>void|Promise<void>}[];
  }):()=>void };
  conversation: { input: { for(ctx:object):{insertQuote(text:string,summary:{label:string;title:string;body:string}):boolean}; requestDraftInitialization(binding:NativeSessionBinding,options:{prompt:string;whenDraftExists:'keep'}):'applied'|'preserved'|'blocked' } };
  sessions: {
    create(options:{workspaceId:string;sessionId:string}):Promise<string>;
    using<T>(id:string,options:{source:string},operation:(ref:{binding:NativeSessionBinding})=>Promise<T>):Promise<T>;
    list: {
    getSnapshot(): { byId: Record<string, { retainedBy: { mainView?: number }; projectionValues: { agentPreset?: string | null } }> };
    subscribe(listener: () => void): () => void;
  } };
}
export interface MarketProps {
  install(target: { spec: string; title: string; version: string; registry?: string }): void;
  openPackage(name: string): void;
}
export interface LauncherProps { wide: boolean; openSettings(section?: string): void }
