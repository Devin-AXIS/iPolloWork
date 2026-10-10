import { requireRuntime } from '@ipollowork/ui/runtime-contract';
import runtimeSource from 'virtual:ipollowork-plugin-ui-runtime';

/** Inline the host-owned runtime inside the sandbox; no network/CSP relaxation. */
export function withSharedUiRuntime(html: string) {
  if (!/<meta\s+name="ipollowork-ui-runtime"\s+content="1"\s*\/?\s*>/i.test(html)) return html;
  const script = `<script data-ipw-runtime="host">${runtimeSource.replaceAll('</script', '<\\/script')}</script>`;
  const withHead = /<head(?:\s[^>]*)?>/i.test(html) ? html : `<head></head>${html}`;
  // Static HTML packages have no bundler. Inline only the public, React-free
  // contract import; the sandbox still loads no external scripts.
  const withContract = withHead.replaceAll(
    'import { requireRuntime } from "@ipollowork/ui/runtime-contract";',
    `const requireRuntime = ${requireRuntime.toString()};`,
  );
  return withContract.replace(/<head(?:\s[^>]*)?>/i, head => `${head}${script}`);
}
