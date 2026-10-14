import React from 'react'
import ReactDOM from 'react-dom/client'
import '@radix-ui/themes/styles.css'
import './theme.css'
import './styles.css'
import './bootstrap'
import App from './App'
import { ExtensionProvider } from './extension-context'
import { PreferencesProvider } from './preferences'
import { connectWorkspaceHost } from './workspace-host'

connectWorkspaceHost()

const root = document.getElementById('root')
if (!root) throw new Error('页面容器不存在')
ReactDOM.createRoot(root).render(
  <React.StrictMode>
    <PreferencesProvider>
      <ExtensionProvider>
        <App />
      </ExtensionProvider>
    </PreferencesProvider>
  </React.StrictMode>,
)
