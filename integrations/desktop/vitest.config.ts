import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin, vitestExecArgv } from '../../vitest.shared.ts'

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    pool: 'forks', execArgv: vitestExecArgv,
    include: ['integrations/desktop/tests/{project-manager,profile-runtime-repair,fatal-recovery,core-package-set,windows-asar-unpack,prepare-package-set,application-overlay,packaged-runtime-verification,desktop-package-environment,speech-cache,cua-helper-stage,cua-helper-live}.spec.ts'],
    setupFiles: ['./scripts/test-proxy-environment.ts'],
  },
})
