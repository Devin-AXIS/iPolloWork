/** Optional Stage bridge. Tokens remain in the account service, never in native tool arguments. */
export interface StageBridge {
  request(action: "status" | "connect" | "disconnect" | "launch" | "catalog" | "document" | "generate" | "export" | "task" | "source", input?: unknown, signal?: AbortSignal): Promise<unknown>;
  download(id:string,signal?:AbortSignal):Promise<Response>;
}
