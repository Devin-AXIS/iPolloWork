import { lazy } from 'react'
import { TableIcon } from '@radix-ui/react-icons'
import { views } from './view-registry'
const GridView = lazy(() => import('./grid-view'))

views.register({
  id: 'grid',
  name: '表格',
  description: '用行和列管理记录',
  icon: TableIcon,
  builtIn: true,
  component: GridView,
})
