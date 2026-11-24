import { GENERATED_ICON_PATHS } from './generated-icon-paths.ts';

// File actions cross the host boundary and do not belong in the formatting toolbar.
export const FILE_CHROME_GROUP = {
  id: 'file',
  labelKey: 'toolbar.file',
  contextual: true,
  controls: [
    {
      id: 'open',
      labelKey: 'toolbar.open',
      paths: GENERATED_ICON_PATHS['file_upload'],
      state: { kind: 'load' },
    },
    {
      id: 'save',
      labelKey: 'toolbar.saveShortcut',
      paths: GENERATED_ICON_PATHS['file_download'],
      state: { kind: 'save' },
    },
    {
      id: 'exportMarkdown',
      labelKey: 'toolbar.exportMarkdown',
      paths: GENERATED_ICON_PATHS['file_download'],
      state: { kind: 'export' },
    },
    {
      id: 'exportPdf',
      labelKey: 'toolbar.exportPdf',
      paths: GENERATED_ICON_PATHS['file_download'],
      state: { kind: 'export' },
    },
    {
      id: 'print',
      labelKey: 'toolbar.print',
      paths: GENERATED_ICON_PATHS['print'],
      state: { kind: 'export' },
    },
    {
      id: 'pageSetup',
      labelKey: 'toolbar.pageSetup',
      paths: GENERATED_ICON_PATHS['settings'],
      state: { kind: 'command' },
    },
  ],
} as const;
