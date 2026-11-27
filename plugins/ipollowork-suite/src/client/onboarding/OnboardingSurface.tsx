/** Body-portaled introduction with shared background interaction ownership. */
import { acquireOverlayInert } from './overlay-inert.ts'
import { IconLoadingOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import { useLayoutEffect, useRef } from 'react'
import type { ReactNode } from 'react'
import { createPortal } from 'react-dom'
import css from './OnboardingSurface.module.css'

// This overlay can mount before the asynchronously linked Suite stylesheet.
const loadingStyles = `
  [data-ipw-onboarding-loading] {
    position: fixed;
    inset: 0;
    z-index: 900;
    display: flex;
    flex-direction: column;
    color-scheme: light dark;
    background: var(--dsw-alias-bg-base, Canvas);
    user-select: none;
  }
  html[data-platform="darwin"] [data-ipw-onboarding-loading] {
    background: transparent;
  }
  [data-ipw-onboarding-loading] > [data-window-drag-controls] {
    display: grid;
    flex: 1;
    min-height: 0;
    grid-template-columns: minmax(0, 1fr);
    place-items: safe center;
    padding: var(--dsh-windows-titlebar-height, 32px) 24px;
    overflow: auto;
  }
  [data-ipw-onboarding-loading] [role="status"] {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 12px;
    min-width: 0;
    color: var(--dsw-alias-label-secondary, CanvasText);
    font-size: 14px;
    line-height: 22px;
    text-align: center;
    overflow-wrap: anywhere;
  }
  [data-ipw-onboarding-loading] [role="status"] > svg {
    flex: none;
    color: var(--dsw-alias-label-primary, CanvasText);
    animation: ipw-onboarding-spin 900ms linear infinite;
  }
  @keyframes ipw-onboarding-spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) {
    [data-ipw-onboarding-loading] [role="status"] > svg { animation: none; }
  }
`

/**
 * Render a body-portaled onboarding stage and keep the application root inert
 * while mounted. Completion reveals the root beneath a fading stage;
 * native titlebar controls, dialogs, and account pages remain above the stage.
 * @param props.children - the step's page content, centered on the stage.
 * @param props.exiting - reveal the application while the owner retains the stage for its 180ms exit.
 * @param props.loading - apply the startup layout before the Suite stylesheet loads.
 * @returns the body-portaled overlay tree.
 */
export function OnboardingSurface({ children, exiting = false, loading = false }:
  { children: ReactNode; exiting?: boolean; loading?: boolean }) {
  const rootState = useRef<{ element: HTMLElement; opacity: string } | null>(null)
  useLayoutEffect(() => {
    const appRoot = document.getElementById('root')
    if (appRoot === null) return
    const releaseInert = acquireOverlayInert(appRoot)
    const previousOpacity = appRoot.style.opacity
    rootState.current = { element: appRoot, opacity: previousOpacity }
    appRoot.style.opacity = '0'
    return () => {
      releaseInert()
      appRoot.style.opacity = previousOpacity
      rootState.current = null
    }
  }, [])
  useLayoutEffect(() => {
    const root = rootState.current
    if (root !== null) root.element.style.opacity = exiting ? root.opacity : '0'
  }, [exiting])

  return createPortal((
    <div className={css.onboardingOverlay} data-exiting={exiting || undefined}
      data-ipw-onboarding-loading={loading ? '' : undefined} role="presentation">
      {loading && <style>{loadingStyles}</style>}
      <div className={css.dragBand} data-window-drag aria-hidden="true" />
      <div className={css.onboardingStage} data-window-drag-controls>{children}</div>
    </div>
  ), document.body)
}

export function OnboardingLoading({ label }: { label: string }) {
  return <OnboardingSurface loading>
    <div role="status">
      <IconLoadingOutlineRegular size={24} aria-hidden="true" />
      <span>{label}</span>
    </div>
  </OnboardingSurface>
}
