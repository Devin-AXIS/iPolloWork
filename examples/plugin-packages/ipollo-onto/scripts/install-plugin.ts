import { mkdir, cp } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'
import { readPackage, pluginInstallPath, loadPluginPackages } from '../src/server/plugin-packages'
import { extensionCatalog } from '../src/core/extensions'

const source = process.argv[2]
if (!source) throw new Error('用法：pnpm plugin:add /完整路径/插件目录；仅安装受信任的本地代码')
const pkg = await readPackage(resolve(source))
await loadPluginPackages()
if (extensionCatalog.some((e) => e.id === pkg.manifest.id))
  throw new Error(`插件 ID 已存在：${pkg.manifest.id}；更新已有包后重启服务，再在扩展中升级`)
const destination = pluginInstallPath(pkg.manifest.id)
await mkdir(dirname(destination), { recursive: true })
await cp(pkg.directory, destination, { recursive: true, errorOnExist: true, force: false })
console.log(
  `已安装 ${pkg.manifest.name} v${pkg.manifest.version}。重启数据服务后可在扩展中启用；前端无需重新构建。`,
)
