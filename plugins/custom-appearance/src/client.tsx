import type { ComponentType } from 'react';
import { Palette as PaletteIcon } from 'lucide-react';
import { titled } from './brand.ts';
import { copy, type Copy } from './copy.ts';
import { brandAttribute, endpoint, logoAttribute, logoPath, makeTheme, packageName, pluginId, presets,
  type Appearance, type Change, type ThemeLayer } from './model.ts';
import { Settings, type View } from './settings.tsx';
import controls from '../../_shared/ui/controls.css';
import css from './view.css';

interface Observable<T> { getSnapshot(): T; subscribe(listener: () => void): () => void }
interface Client {
  locale: Observable<{ active: string }>;
  theme: { overrideTokens(source: string, tokens: ThemeLayer): () => void };
  slots: {
    inject(name: string, install: () => () => void): () => void;
    register<P>(options: { name: string; id?: string; order?: number; label?: () => string; priority?: number;
      inject?: () => Record<string, unknown> }, component: ComponentType<P>): () => void;
  };
  effect(install: () => void | (() => void), description?: string): unknown;
  inject(names: ['ipolloSuiteThemeReady'], install: (scope: Client) => void): unknown;
}
export const inject = ['slots', 'locale', 'theme'];

function address(path: string) { return new URL(path.slice(1), document.baseURI).href; }
function logoUrl(revision: number) { return address(logoPath) + '?v=' + revision; }

async function request(signal: AbortSignal, change?: Change): Promise<Appearance> {
  const response = await fetch(address(endpoint), {
    signal, ...(change && { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(change) }),
  });
  const data = await response.json() as Appearance & { error?: string };
  if (!response.ok) throw new Error(data.error ?? 'save');
  return data;
}

export function apply(ctx: Client) {
  if ('__DSH_LIVESHARE_VIEWER__' in globalThis) return;
  const lifetime = new AbortController();
  const listeners = new Set<() => void>();
  let view: View = { state: 'loading' };
  let generation = 0;
  const appearance: Observable<View> = {
    getSnapshot: () => view,
    subscribe(listener) { listeners.add(listener); return () => { listeners.delete(listener); }; },
  };
  const labels: Observable<Copy> = {
    getSnapshot: () => copy(ctx.locale.getSnapshot().active),
    subscribe: listener => ctx.locale.subscribe(listener),
  };
  let restorePalette: (() => void) | undefined;
  function syncPalette() {
    const saved = view.state === 'ready' ? view.profile : undefined;
    if (!saved || saved.active === 'default') { restorePalette?.(); restorePalette = undefined; return; }
    restorePalette = ctx.theme.overrideTokens(packageName, makeTheme(saved.active === 'custom' ? saved.custom : presets[saved.active]));
  }

  const root = document.documentElement;
  let title = root.getAttribute(brandAttribute) ?? '';
  const defaultTitle = () => document.body.hasAttribute('data-ipw-suite') ? 'iPolloWork' : 'DeepSeek Harness';
  const observer = new MutationObserver(() => {
    if (!title) return;
    const next = titled(document.title, title, title);
    if (next !== document.title) document.title = next;
  });
  const originalLinks = [...document.head.querySelectorAll<HTMLLinkElement>('link[rel="icon"], link[rel="apple-touch-icon"]')]
    .filter(link => !link.hasAttribute(logoAttribute));
  let logoRevision: number | null | undefined;
  function syncIcons(revision: number | null) {
    if (revision === logoRevision) return;
    logoRevision = revision;
    const existing = [...document.head.querySelectorAll<HTMLLinkElement>('link[' + logoAttribute + ']')];
    if (revision !== null) {
      for (const link of originalLinks) link.remove();
      for (const rel of ['icon', 'apple-touch-icon']) {
        const link = existing.find(node => node.rel === rel) ?? document.createElement('link');
        link.rel = rel;
        link.type = 'image/png';
        link.href = logoUrl(revision);
        link.setAttribute(logoAttribute, '');
        if (!link.isConnected) document.head.append(link);
      }
      return;
    }
    if (!existing.length) return;
    for (const link of existing) link.remove();
    if (originalLinks.length) document.head.append(...originalLinks);
    else {
      const suite = document.body.hasAttribute('data-ipw-suite');
      for (const [rel, path] of [
        ['icon', suite ? '/ipollowork-suite/brand/favicon.svg' : '/favicon.svg'],
        ['apple-touch-icon', suite ? '/ipollowork-suite/brand/apple-touch-icon.png' : '/apple-touch-icon.png'],
      ] as const) {
        const link = document.createElement('link');
        link.rel = rel;
        link.href = address(path);
        document.head.append(link);
        originalLinks.push(link);
      }
    }
  }
  const brandHooks = { hooks: { appearance, labels } };
  let brandSlots: (() => void)[] = [];
  let brandBits = 0;
  const slot = <P,>(name: string, component: ComponentType<P>) => ctx.slots.inject(name, () => ctx.slots.register({
    name, priority: -110, inject: () => brandHooks,
  }, component));
  function syncBrand(profile: Appearance) {
    if (profile.name !== title) {
      const next = titled(document.title, title, profile.name || defaultTitle());
      title = profile.name;
      if (title) root.setAttribute(brandAttribute, title); else root.removeAttribute(brandAttribute);
      document.title = next;
    }
    syncIcons(profile.hasLogo ? profile.revision : null);
    const bits = Number(!!profile.name) + 2 * Number(profile.hasLogo);
    if (bits === brandBits) return;
    brandSlots.forEach(unmount => unmount());
    brandSlots = [];
    brandBits = bits;
    if (profile.name) brandSlots.push(slot('sidebar.brand.name', BrandName));
    if (profile.hasLogo) brandSlots.push(slot('sidebar.brand.mark', BrandIcon));
    if (bits) brandSlots.push(slot('conversation.hero.brand.mark', Hero));
  }
  function publish(next: View) {
    if (lifetime.signal.aborted) return;
    view = next;
    if (next.state === 'ready') { syncPalette(); syncBrand(next.profile); }
    listeners.forEach(listener => listener());
  }
  const reload = () => {
    const operation = ++generation;
    if (view.state !== 'ready') publish({ state: 'loading' });
    void request(lifetime.signal).then(profile => {
      if (operation === generation) publish({ state: 'ready', profile });
    }, () => { if (operation === generation && view.state !== 'ready') publish({ state: 'error' }); });
  };
  const save = async (change: Change) => {
    const operation = ++generation;
    try {
      const profile = await request(lifetime.signal, change);
      if (operation === generation) publish({ state: 'ready', profile });
    } catch (error) {
      if (error instanceof Error && error.message === 'changed') reload();
      throw error;
    }
  };

  ctx.effect(() => {
    const style = document.createElement('style');
    style.textContent = controls + '\n' + css;
    document.head.append(style);
    observer.observe(document.head, { subtree: true, childList: true, characterData: true });
    reload();
    return () => {
      lifetime.abort();
      observer.disconnect();
      style.remove();
      restorePalette?.();
      brandSlots.forEach(unmount => unmount());
      syncIcons(null);
      if (title) {
        root.removeAttribute(brandAttribute);
        document.title = titled(document.title, title, defaultTitle());
      }
    };
  }, 'apply saved appearance');
  // The Suite loads its default palette after its own async settings request.
  ctx.inject(['ipolloSuiteThemeReady'], scope => scope.effect(() => { syncPalette(); }, 'apply appearance over the Suite palette'));
  ctx.effect(() => ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: pluginId, order: 0, label: () => labels.getSnapshot().header,
    inject: () => ({ ...brandHooks, reload, save, logoUrl }),
  }, Settings)), 'custom appearance settings');
  ctx.effect(() => ctx.slots.inject('settings.section.icon', () => ctx.slots.register({
    name: 'settings.section.icon', id: pluginId,
  }, ({ size }: { size: number }) => <PaletteIcon size={size} strokeWidth={1.65} aria-hidden />)), 'custom appearance settings icon');
}

interface BrandProps {
  useAppearance<T>(select: (value: View) => T): T;
  useLabels<T>(select: (value: Copy) => T): T;
}
function BrandName({ useAppearance }: BrandProps) {
  const view = useAppearance(value => value);
  return view.state === 'ready' && <span className="ipa-sidebar-name">{view.profile.name}</span>;
}
function BrandIcon({ size, useAppearance }: BrandProps & { size: number }) {
  const view = useAppearance(value => value);
  return view.state === 'ready' && <img className="ipa-sidebar-logo" width={size} height={size} src={logoUrl(view.profile.revision)} alt="" />;
}
function Hero({ useAppearance, useLabels }: BrandProps) {
  const view = useAppearance(value => value);
  const t = useLabels(value => value);
  if (view.state !== 'ready') return null;
  const { profile } = view;
  return <span className="ipa-hero" data-ipw-hero="">
    <span className="ipa-hero-brand">
      {profile.hasLogo && <img src={logoUrl(profile.revision)} alt="" />}
      <strong>{profile.name || 'iPolloWork'}</strong>
    </span>
    <span data-ipw-hero-title="">{t.headline}</span>
  </span>;
}
