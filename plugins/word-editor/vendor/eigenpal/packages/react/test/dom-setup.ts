// Registers happy-dom BEFORE anything else in a test module is evaluated.
//
// This has to be its own module. ESM hoists every `import` and evaluates them in order
// before any top-level statement runs, so a `GlobalRegistrator.register()` written as a
// statement in the test file executes only after every import — including Vue's runtime-dom,
// which captures `document` at module scope and would capture null.
import { GlobalRegistrator } from '@happy-dom/global-registrator';

if (!GlobalRegistrator.isRegistered) GlobalRegistrator.register();
