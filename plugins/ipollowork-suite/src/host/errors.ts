/** Structured failures returned without request bodies, credentials, or upstream diagnostics. */
import { HarnessError } from '@deepseek-ai/dsh-error'
export class SuiteError extends HarnessError {
  constructor(code: string, readonly status = 400, options?: ErrorOptions) { super(code, code, options) }
}
/** An app data rejection keeps the account service's explanation of what is wrong with the statement. */
export class AppDataRejection extends SuiteError {
  constructor(code: string, status: number, readonly reason: string) {
    super(code, status)
    this.message = `${code}: ${reason}`
  }
}
