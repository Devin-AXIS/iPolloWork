import { defineConfig } from 'vitest/config'
import tsconfigPaths from 'vite-tsconfig-paths'
import { standardDecoratorPlugin, vitestExecArgv } from '../../vitest.shared.ts'

export default defineConfig({
  plugins: [tsconfigPaths({ projects: ['./tsconfig.base.json'] }), standardDecoratorPlugin()],
  test: {
    pool: 'forks', execArgv: vitestExecArgv,
    include: ['integrations/desktop/tests/{project-manager,profile-runtime-repair,fatal-recovery,core-package-set,windows-asar-unpack,prepare-package-set,application-overlay,packaged-runtime-verification,desktop-package-environment,speech-cache,cua-helper-stage,cua-helper-live,welcome-host}.spec.ts',
      'integrations/desktop/tests/account-origin.spec.ts',
      'integrations/desktop/tests/welcome-renderer.client.spec.tsx'],
    setupFiles: ['./scripts/test-proxy-environment.ts'],
  },
})
