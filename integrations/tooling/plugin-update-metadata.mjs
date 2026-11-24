/** The target installer's reviewed DSH and product plugin archives. */
export function pluginUpdateMetadata(read) {
  const runtime = read('integrations/runtime/upstream.json').npmVersion
  const catalog = 'plugins/ipollowork-suite/catalog/'
  const { plugins } = read(catalog + 'bundled-releases.json')
  const { plugins: index } = read(catalog + 'index.json')
  if (typeof runtime !== 'string' || !Array.isArray(plugins) || plugins.length === 0) {
    throw new Error('Missing desktop plugin compatibility metadata')
  }
  return {
    runtime,
    plugins: plugins.map(({ name, version, sha256 }) => {
      if (!index.find(item => item.name === name)?.versions.some(item => item.version === version && item.engines?.dsh === runtime)) {
        throw new Error(`Unreviewed desktop plugin archive: ${name}@${version}`)
      }
      return { name, version, sha256 }
    }),
  }
}
