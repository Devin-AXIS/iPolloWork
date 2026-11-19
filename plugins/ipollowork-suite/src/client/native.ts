/** Minimal public DSH client capabilities consumed by the suite. */
import type { ComponentType } from 'react'
import type { ClientRemote, PluginInstallProgress } from '@deepseek-ai/dsh-api-remotes/client'
import type { IWorkspaces, WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
export interface NativeSessionBinding { readonly sessionId:string; readonly ctx:object }
/** Credential-free result supplied to the optional native sharing hook. */
interface SharingPreparation { readonly connected?:boolean; readonly error?:string }
export interface SlotOptions<P> {
  name: string; locale?: string; id?: string; key?: string; order?: number; priority?: number; label?: () => string;
  inject?: () => Record<string, unknown>;
  children?: Record<string, { kind: 'single'; scope: 'session' }>;
}
export interface ClientContext {
  inject(dependencies: readonly ['ipolloDesignTemplates'], callback: (scope: ClientContext & { ipolloDesignTemplates: import('../shared/design-templates.ts').DesignTemplateSources }) => void): unknown;
  inject(dependencies: readonly ['remote.pluginManager'], callback: (scope: ClientContext) => void): unknown;
  inject(dependencies: readonly ['remoteAccess'], callback: (scope: ClientContext) => void): unknown;
  inject(dependencies: readonly ['remote.liveshareShares'], callback: (scope: {
    remote: { liveshareShares: import('./sharing/owner-shares.ts').OwnerShares }
  }) => void): unknown;
  configForms: import('@deepseek-ai/dsh-client-ui-settings/client').ConfigForms;
  provide(name: 'ipolloConnections', value: import('../shared/connections.ts').ConnectionManager): void;
  provide(name: 'ipolloData', value: import('../shared/app-data.ts').IpolloData): void;
  effect(effect: () => void | (() => void), label?: string): unknown;
  slots: {
    inject(name: string, install: () => void | (() => void) | Iterable<() => void>): unknown;
    register<P>(options: SlotOptions<P>, component: ComponentType<P>): () => void;
  };
  theme: { overrideTokens(source: string, tokens: Record<string, { light: string; dark: string }>): () => void };
  locale: { bind(namespace: string): (key: string) => string; getSnapshot(): { active?: string; locale?: string; language?: string } | string; subscribe(listener: () => void): () => void };
  remote: {
    pluginManager: ClientRemote['pluginManager'];
    settings: ClientRemote['settings'];
    $on(event: 'credentials/record-updated', listener: (key: string) => void): () => void;
    $on(event: 'plugin-manager/install-state', listener: (progress: PluginInstallProgress) => void): () => void;
    $on(event: string, listener: () => void): () => void;
  };
  on(name: string, listener: () => void): () => void;
  on(name: 'ipollowork/prepare-share', listener: (signal: AbortSignal, next: () => Promise<SharingPreparation>) => Promise<SharingPreparation>): () => void;
  layout: { selectPanel(id: string): void };
  remoteAccess: { source(kind: 'session', id: string, action: string): { getSnapshot(): boolean } };
  uiWorkspace: {
    archiveSession: IWorkspaces['archiveSession'];
    openSession(sessionId: string): void;
    openWorkspace(workspaceId: string): Promise<void>;
    pickDirectory(): Promise<string | null>;
    listDirectory(path?:string,signal?:AbortSignal): Promise<{
      path:string;home:string;entries:{name:string;path:string;hidden:boolean}[];crumbs:{name:string;path:string}[];truncated:boolean;
    }>;
    createDirectory(path:string,name:string):Promise<string>;
  };
  workspaces: { create(input:{path:string}):Promise<{workspaceId:string;path:string;title:string}>; list: {
    getSnapshot(): Pick<WorkspaceSnapshot, 'archivedSessionIds'> & { phase: 'pending' | 'ready'; items: readonly { workspaceId:string;title:string;path:string;sessionIds:readonly string[] }[] };
    subscribe(listener:()=>void):()=>void;
  } };
  contextMenus: { register(contribution:{
    id:string;target:'workspace'|'session'|'sessionHeader';order:number;
    observe?(input:ContextMenuTarget):readonly { getSnapshot(): unknown }[];
    resolve(input:ContextMenuTarget):{id:string;label:string;icon?:{key:string};danger?:boolean;separatorBefore?:boolean;run:()=>void|Promise<void>}[];
  }):()=>void };
  conversation: { input: { for(ctx:object):{insertQuote(text:string,summary:{label:string;title:string;body:string}):boolean}; requestDraftInitialization(binding:NativeSessionBinding,options:{prompt:string;whenDraftExists:'keep'}):'applied'|'preserved'|'blocked' } };
  sessions: {
    refresh: ISessions['refresh'];
    create(options:{workspaceId:string;sessionId:string}):Promise<string>;
    using<T>(id:string,options:{source:string},operation:(ref:{binding:NativeSessionBinding})=>Promise<T>):Promise<T>;
    list: ISessions['list'];
  };
}
type ContextMenuTarget = { workspaceId?: string; sessionId?: Parameters<IWorkspaces['archiveSession']>[0]; displayTitle?: string };
export interface MarketProps {
  openPackage(name: string): void;
}
export interface LauncherProps { wide: boolean; openSettings(section?: string): void }
