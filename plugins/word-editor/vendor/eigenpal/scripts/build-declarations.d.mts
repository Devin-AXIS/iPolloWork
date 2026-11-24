import type { Options } from 'tsup';

/** Per-config declaration settings. See scripts/build-declarations.mjs. */
export interface DeclarationSettings {
  /** Text written at the top of every declaration file. */
  banner?: string;
  /** Extra compiler options for the declaration emit, such as Vue's JSX settings. */
  compilerOptions?: Record<string, unknown>;
  /** Declaration files that no import reaches, such as a `declare module` shim. */
  ambient?: string[];
}

export type ConfigWithDeclarations = Options & {
  /**
   * Settings for the declaration build of the config's entries, or one declaration program
   * per item, each over its own entries, for a bundle whose entries need different compiler
   * options.
   */
  declarations?:
    | DeclarationSettings
    | (DeclarationSettings & { entry: string[] | Record<string, string> })[];
};

export declare function withDeclarations(
  configUrl: string | URL,
  config: ConfigWithDeclarations
): (cli?: Options) => Options;
export declare function withDeclarations(
  configUrl: string | URL,
  config: ConfigWithDeclarations[]
): (cli?: Options) => Options[];

export declare function buildDeclarations(
  configUrl: string | URL,
  options: DeclarationSettings & {
    entry: string[] | Record<string, string>;
    outDir?: string;
  }
): Promise<void>;

export declare function declarationExtensions(manifest: { type?: string }): string[];
export declare function entryMap(entry: string[] | Record<string, string>): Record<string, string>;
export declare function jsonType(value: unknown, indent?: string, siblingKeys?: string[]): string;
export declare function typesCondition(target: unknown): string | undefined;
export declare function publishedDeclaration(specifier: string, fromDir: string): string;

/** The `@packageDocumentation` comment of an entry's source, or null. */
export declare function packageDocumentationOf(source: string): string | null;
