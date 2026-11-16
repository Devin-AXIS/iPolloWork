/** Audit the dependency lockfiles owned and distributed by iPolloWork. */
import {run,root} from './upstream.mjs'
import {join} from 'node:path'
for(const directory of ['integrations/runtime','integrations/publisher','plugins/ipollowork-suite','services/ipollowork']) {
 await run(process.platform==='win32'?'npm.cmd':'npm',['audit','--package-lock-only','--audit-level=low','--workspaces=false'],{cwd:join(root,directory)})
}
