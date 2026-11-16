/** Verify official dependency bytes and ensure its implementation is outside the product repository. */
import { prepareSource, verifySource, pin } from '../tooling/upstream.mjs'
await prepareSource()
await verifySource()
console.log(`Official DSH ${pin.npmVersion}: archive and source inventory verified`)
