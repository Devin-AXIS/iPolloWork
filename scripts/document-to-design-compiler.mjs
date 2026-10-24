import { pathToFileURL } from "node:url";

import { compileDocumentToVideo } from "./document-to-video-compiler.mjs";

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  compileDocumentToVideo(process.argv.slice(2))
    .then((result) => {
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((error) => {
      console.error(error instanceof Error ? error.message : String(error));
      process.exitCode = 1;
    });
}

export { compileDocumentToVideo as compileDocumentToDesign };
