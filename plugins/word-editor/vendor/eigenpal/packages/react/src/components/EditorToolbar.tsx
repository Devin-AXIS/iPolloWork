import type { ReactNode } from 'react';
/**
 * EditorToolbar — Google Docs-style 2-level compound component.
 *
 * Usage:
 *   <EditorToolbar {...toolbarProps}>
 *     <EditorToolbar.TitleBar>
 *       <EditorToolbar.Logo><MyIcon /></EditorToolbar.Logo>
 *       <EditorToolbar.DocumentName value={name} onChange={setName} />
 *       <EditorToolbar.MenuBar />
 *       <EditorToolbar.TitleBarRight>
 *         <button>Save</button>
 *       </EditorToolbar.TitleBarRight>
 *     </EditorToolbar.TitleBar>
 *     <EditorToolbar.Toolbar />
 *   </EditorToolbar>
 */

import { EditorToolbarContext } from './EditorToolbarContext';
import type { EditorToolbarProps } from './EditorToolbarContext';
import { TitleBar, Logo, DocumentName, MenuBar, TitleBarRight } from './TitleBar';
import type { TitleBarProps, LogoProps, DocumentNameProps, TitleBarRightProps } from './TitleBar';
import { Toolbar } from './Toolbar';
import { cn } from '../lib/utils';
import { Z_INDEX } from '../styles/zIndex';

// ============================================================================
// Main compound component
// ============================================================================

interface EditorToolbarComponent {
  (props: EditorToolbarProps & { children: ReactNode }): React.JSX.Element;
  TitleBar: typeof TitleBar;
  Logo: typeof Logo;
  DocumentName: typeof DocumentName;
  MenuBar: typeof MenuBar;
  TitleBarRight: typeof TitleBarRight;
  Toolbar: typeof Toolbar;
}

function EditorToolbarBase({
  children,
  className,
  style,
  ...toolbarProps
}: EditorToolbarProps & { children: ReactNode; style?: React.CSSProperties }) {
  return (
    <EditorToolbarContext.Provider value={toolbarProps}>
      <div
        className={cn('flex flex-col bg-doc-surface shadow-sm flex-shrink-0', className)}
        style={{ position: 'relative', zIndex: Z_INDEX.toolbar, ...style }}
        data-testid="editor-toolbar"
      >
        {children}
      </div>
    </EditorToolbarContext.Provider>
  );
}

// Attach sub-components as static properties
const EditorToolbar = EditorToolbarBase as EditorToolbarComponent;
EditorToolbar.TitleBar = TitleBar;
EditorToolbar.Logo = Logo;
EditorToolbar.DocumentName = DocumentName;
EditorToolbar.MenuBar = MenuBar;
EditorToolbar.TitleBarRight = TitleBarRight;
EditorToolbar.Toolbar = Toolbar;

export { EditorToolbar };
export type { EditorToolbarProps, TitleBarProps, LogoProps, DocumentNameProps, TitleBarRightProps };
