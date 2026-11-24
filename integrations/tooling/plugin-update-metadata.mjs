/** The target installer's reviewed DSH and product plugin archives. */
export function pluginUpdateMetadata(read) {
  const runtime = read('integrations/runtime/upstream.json').npmVersion
  const catalog = 'plugins/ipollowork-suite/catalog/'
  const { plugins } = read(catalog + 'bundled-releases.json')
  const { plugins: index } = read(catalog + 'index.json')
  if (typeof runtime !== 'string' || !Array.isArray(plugins) || plugins.length === 0) {
    throw new Error('Missing desktop plugin compatibility metadata')
  }
  const retired = plugins.some(plugin => plugin.upgradeOnly === true)
    ? new Set(read(catalog + 'retired-plugins.json')) : new Set()
  return {
    runtime,
    plugins: plugins.map(({ name, version, sha256, upgradeOnly }) => {
      const entry = index.find(item => item.name === name)
      const reviewed = upgradeOnly === true
        ? entry === undefined && retired.has(name)
        : entry?.versions.some(item => item.version === version && item.engines?.dsh === runtime)
      if (!reviewed) {
        throw new Error(`Unreviewed desktop plugin archive: ${name}@${version}`)
      }
      return { name, version, sha256 }
    }),
  }
}
