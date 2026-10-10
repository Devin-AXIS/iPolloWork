import runtimeSource from 'virtual:ipollowork-plugin-ui-runtime';

/** Inline the host-owned runtime inside the sandbox; no network/CSP relaxation. */
export function withSharedUiRuntime(html: string) {
  if (!/<meta\s+name="ipollowork-ui-runtime"\s+content="1"\s*\/?\s*>/i.test(html)) return html;
  const script = `<script data-ipw-runtime="host">${runtimeSource.replaceAll('</script', '<\\/script')}</script>`;
  const withHead = /<head(?:\s[^>]*)?>/i.test(html) ? html : `<head></head>${html}`;
  return withHead.replace(/<head(?:\s[^>]*)?>/i, head => `${head}${script}`);
}
