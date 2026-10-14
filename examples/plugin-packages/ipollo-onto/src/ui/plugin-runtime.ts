import type { ExplorationQuery, GraphExploration } from '../core/exploration'
import { FieldTypeIcon, EntityIcon } from './components/icons'
import { translate as tr, useLocale, getLocale, translateFor } from './i18n'
import React, { lazy } from 'react'
import { Button, TextField, TextArea, Select, DropdownMenu, IconButton } from '@radix-ui/themes'
import { fieldEditors, type FieldEditor } from './fields/editor-registry'
import { ChoiceInput } from './fields/input-controls'
import {
  GridIcon,
  Share2Icon,
  PlusIcon,
  DotsHorizontalIcon,
  MixerHorizontalIcon,
} from '@radix-ui/react-icons'
import type { ExtensionState } from '../core/extensions'
import { fieldTypes } from '../core/fields'
import { PluginScope } from '../core/plugin-scope'
import { views, type ViewProps } from './view-registry'
import { FieldValue } from './fields/value'
import { ErrorNotice } from './components/primitives'
import { api, message } from './api'
import type { RelationGraph, GraphRecordSearch } from '../core/contracts'

const active = new Map<string, { digest: string; scope: PluginScope }>()
class PluginViewBoundary extends React.Component<{ children: React.ReactNode }, { error: string }> {
  state = { error: '' }
  static getDerivedStateFromError(error: unknown) {
    return { error: message(error) }
  }
  render() {
    return this.state.error
      ? React.createElement(ErrorNotice, {
          error: tr('扩展运行失败：{0}', { 0: this.state.error }),
        })
      : this.props.children
  }
}
let queue = Promise.resolve<ExtensionState[]>([])
export function syncClientPlugins(states: ExtensionState[]) {
  queue = queue.catch(() => []).then(() => sync(states))
  return queue
}
async function sync(states: ExtensionState[]): Promise<ExtensionState[]> {
  const desired = states.filter(
    (e) => e.entrypoints && e.enabled && e.installedVersion === e.version && !e.loadError,
  )
  for (const [id, current] of [...active].reverse())
    if (!desired.some((e) => e.id === id && e.digest === current.digest)) {
      try {
        current.scope.dispose()
      } catch (error) {
        console.error(tr('插件 {0} 清理失败', { 0: id }), error)
      } finally {
        active.delete(id)
      }
    }
  const result = states.map((e) => ({ ...e })),
    visiting = new Set<string>()
  async function load(id: string) {
    if (active.has(id)) return
    const extension = result.find((e) => e.id === id)
    if (
      !extension ||
      !extension.enabled ||
      extension.installedVersion !== extension.version ||
      extension.loadError
    )
      throw new Error(tr('依赖不可用：{0}', { 0: extension?.name ?? id }))
    if (visiting.has(id)) throw new Error(tr('插件循环依赖：{0}', { 0: id }))
    visiting.add(id)
    for (const dependency of extension.dependencies) await load(dependency)
    if (!extension.entrypoints || !extension.digest) {
      visiting.delete(id)
      return
    }
    const scope = new PluginScope()
    const context = {
      React,
      i18n: { translate: tr, useLocale, getLocale, translateFor },
      components: {
        FieldValue,
        FieldTypeIcon,
        EntityIcon,
        Button,
        TextField,
        TextArea,
        ChoiceInput,
        Select,
        DropdownMenu,
        IconButton,
        icons: {
          cards: GridIcon,
          relations: Share2Icon,
          plus: PlusIcon,
          more: DotsHorizontalIcon,
          settings: MixerHorizontalIcon,
        },
      },
      services: {
        graphExplore: (tableId: string, input: ExplorationQuery) =>
          api<GraphExploration>(
            `/tables/${encodeURIComponent(tableId)}/graph/explore`,
            'POST',
            input,
          ),
        graphCanvas: () => import('./components/graph-canvas'),
        graphRecords: (anchorId: string, input: { query: string; tableId?: string }) => {
          const params = new URLSearchParams({ q: input.query })
          if (input.tableId) params.set('tableId', input.tableId)
          return api<GraphRecordSearch>(
            `/tables/${encodeURIComponent(anchorId)}/graph/records?${params}`,
          )
        },
        graph: (
          tableId: string,
          input: { page?: number; recordId?: string; seedIds?: string[] },
        ) => {
          const params = new URLSearchParams()
          if (input.page) params.set('page', String(input.page))
          if (input.recordId) params.set('recordId', input.recordId)
          if (input.seedIds) params.set('seedIds', input.seedIds.join(','))
          return api<RelationGraph>(`/tables/${encodeURIComponent(tableId)}/graph?${params}`)
        },
      },
      fields: scope.registry(fieldTypes, extension.contributes.fields ?? []),
      fieldEditors: {
        get: (id: string) => fieldEditors.get(id),
        register: (editor: FieldEditor) => {
          if (
            typeof editor.component !== 'function' ||
            (editor.configure && typeof editor.configure !== 'function')
          )
            throw new Error(tr('字段输入插件契约无效'))
          scope.registry(fieldEditors, extension.contributes.fields ?? []).register({
            ...editor,
            component: (props) =>
              React.createElement(
                PluginViewBoundary,
                null,
                React.createElement(editor.component, props),
              ),
            configure: editor.configure
              ? (props) =>
                  React.createElement(
                    PluginViewBoundary,
                    null,
                    React.createElement(editor.configure!, props),
                  )
              : undefined,
          })
        },
      },
      views: scope.registry(views, extension.contributes.views ?? []),
      effect: (cleanup: () => void) => scope.effect(cleanup),
    }
    const url = (file: string) => `/api/extensions/${id}/assets/${file}?v=${extension.digest}`
    try {
      if (extension.entrypoints.shared) {
        const module = await import(/* @vite-ignore */ url(extension.entrypoints.shared))
        if (typeof module.activate !== 'function') throw new Error(tr('插件缺少 activate 入口'))
        await module.activate(context)
      }
      if (extension.entrypoints.client && extension.contributes.fields?.length) {
        const module = await import(/* @vite-ignore */ url(extension.entrypoints.client))
        if (typeof module.activate !== 'function') throw new Error(tr('插件缺少 activate 入口'))
        await module.activate({ ...context, fields: scope.registry(fieldTypes, []) })
      } else if (extension.entrypoints.client) {
        // View code is fetched only when this view is opened.
        const file = extension.entrypoints.client
        let prepared: Promise<void> | undefined
        const localViews = new Map<string, ReturnType<typeof views.get>>()
        const clientScope = new PluginScope()
        scope.effect(() => clientScope.dispose())
        const prepare = () =>
          (prepared ??= (async () => {
            try {
              const module = await import(/* @vite-ignore */ url(file))
              if (typeof module.activate !== 'function')
                throw new Error(tr('插件缺少 activate 入口'))
              await module.activate({
                ...context,
                fields: clientScope.registry(fieldTypes, []),
                effect: (cleanup: () => void) => clientScope.effect(cleanup),
                views: {
                  register(view: ReturnType<typeof views.get>) {
                    if (!extension.contributes.views?.includes(view.id) || localViews.has(view.id))
                      throw new Error(tr('视图注册与声明不一致'))
                    localViews.set(view.id, view)
                    clientScope.effect(() => {
                      localViews.delete(view.id)
                    })
                  },
                },
              })
              for (const id of extension.contributes.views ?? [])
                if (!localViews.has(id)) throw new Error(tr('视图未注册：{0}', { 0: id }))
            } catch (error) {
              clientScope.dispose()
              throw error
            }
          })())
        for (const viewId of extension.contributes.views ?? []) {
          const component = lazy<React.ComponentType<ViewProps>>(async () => {
            try {
              await prepare()
              const view = localViews.get(viewId)
              if (!view) throw new Error(tr('插件未注册声明的视图'))
              return {
                default: (props: React.ComponentProps<typeof view.component>) =>
                  React.createElement(
                    PluginViewBoundary,
                    null,
                    React.createElement(view.component, props),
                  ),
              }
            } catch (error) {
              return {
                default: () =>
                  React.createElement(ErrorNotice, {
                    error: tr('视图加载失败：{0}', { 0: message(error) }),
                  }),
              }
            }
          })
          context.views.register({
            id: viewId,
            name: extension.name.replace(/视图$/, ''),
            description: extension.description,
            icon: extension.icon
              ? () => React.createElement(EntityIcon, { name: extension.icon! })
              : viewId === 'cards'
                ? GridIcon
                : Share2Icon,
            component,
          })
        }
      }
      active.set(id, { digest: extension.digest, scope })
    } catch (error) {
      scope.dispose()
      extension.loadError = message(error)
      throw error
    } finally {
      visiting.delete(id)
    }
  }
  for (const e of desired) {
    try {
      await load(e.id)
    } catch (error) {
      const item = result.find((x) => x.id === e.id)!
      item.loadError = message(error)
    }
  }
  return result
}
