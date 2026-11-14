/** Structured failures returned without request bodies, credentials, or upstream diagnostics. */
import { HarnessError } from '@deepseek-ai/dsh-error'
export class SuiteError extends HarnessError {
  constructor(code: string, readonly status = 400, options?: ErrorOptions) { super(code, code, options) }
}
