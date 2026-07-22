declare const __CLI_VERSION__: string | undefined;
export const VERSION = typeof __CLI_VERSION__ !== "undefined" ? __CLI_VERSION__ : "0.0.0-dev";
