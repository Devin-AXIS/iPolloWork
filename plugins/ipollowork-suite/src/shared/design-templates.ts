/** Optional Design client protocol. Contains resource content, never account credentials. */
export interface DesignTemplateSource {
  id: string;
  title: string;
  list(signal?: AbortSignal): Promise<readonly { id: string; title: string; description: string; version: string; sourceName: string }[]>;
  read(id: string, version: string): Promise<string>;
}
export interface DesignTemplateSources { register(source: DesignTemplateSource): () => void }
