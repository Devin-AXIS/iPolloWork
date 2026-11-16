import { createRequire } from 'node:module';

// Native require avoids empty CommonJS re-exports after DSH hot reloads (#537).
const require = createRequire(import.meta.url);
export default require('qrcode');
