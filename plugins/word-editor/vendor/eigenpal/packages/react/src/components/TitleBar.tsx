import type { ReactNode } from 'react';
/**
 * TitleBar and sub-components for the Google Docs-style 2-level toolbar.
 *
 * - TitleBar: two-row layout (row 1: logo + doc name + right actions, row 2: menu bar)
 * - Logo: renders custom logo content left-aligned
 * - DocumentName: editable document name input
 * - MenuBar: File/Format/Insert menus (auto-wired from EditorToolbarContext)
 * - TitleBarRight: right-aligned actions slot
 */

import React, { useCallback, Children, isValidElement } from 'react';
import { MenuDropdown } from './ui/MenuDropdown';
import type { MenuEntry } from './ui/MenuDropdown';
import { TableGridInline } from './ui/TableGridInline';
import { MaterialSymbol } from './ui/MaterialSymbol';
import { useEditorToolbar } from './EditorToolbarContext';
import type { FormattingAction } from './Toolbar';
import { useTranslation } from '../i18n';
import { openReportIssue } from './reportIssue';
import { hostWindowOf } from '@docx-editor.dev/core/editor';

// ============================================================================
// BreakSubmenu — vertical list of break choices shown inside the Insert menu's
// "Break" submenu panel. Styled to match the menu items in MenuDropdown.
// ============================================================================

interface BreakSubmenuItem {
  icon: string;
  label: string;
  onClick?: () => void;
}

function BreakSubmenu({ items, closeMenu }: { items: BreakSubmenuItem[]; closeMenu: () => void }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', minWidth: 220 }}>
      {items.map((item) => {
        const disabled = !item.onClick;
        return (
          <button
            key={item.label}
            type="button"
            disabled={disabled}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 12px',
              border: 'none',
              background: 'transparent',
              cursor: disabled ? 'default' : 'pointer',
              fontSize: 13,
              color: 'var(--doc-text)',
              width: '100%',
              textAlign: 'left',
              whiteSpace: 'nowrap',
              opacity: disabled ? 0.4 : 1,
            }}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              if (disabled) return;
              item.onClick?.();
              closeMenu();
            }}
            onMouseOver={(e) => {
              if (!disabled) {
                (e.currentTarget as HTMLButtonElement).style.backgroundColor =
                  'var(--doc-bg-hover)';
              }
            }}
            onMouseOut={(e) => {
              (e.currentTarget as HTMLButtonElement).style.backgroundColor = 'transparent';
            }}
          >
            <MaterialSymbol name={item.icon} size={18} />
            <span>{item.label}</span>
          </button>
        );
      })}
    </div>
  );
}

// ============================================================================
// Default Doc Icon (shown when no Logo is provided)
// ============================================================================

function DefaultDocIcon() {
  return (
    <svg width="32" height="40" viewBox="0 0 32 40" fill="none" xmlns="http://www.w3.org/2000/svg">
      <path
        d="M2 0C0.9 0 0 0.9 0 2V38C0 39.1 0.9 40 2 40H30C31.1 40 32 39.1 32 38V10L22 0H2Z"
        fill="#cbd5e1"
      />
      <path d="M22 0L32 10H24C22.9 10 22 9.1 22 8V0Z" fill="#94a3b8" />
      <rect x="7" y="18" width="18" height="2" rx="1" fill="#fff" />
      <rect x="7" y="23" width="18" height="2" rx="1" fill="#fff" />
      <rect x="7" y="28" width="12" height="2" rx="1" fill="#fff" />
    </svg>
  );
}

// ============================================================================
// Logo
// ============================================================================

export interface LogoProps {
  children: ReactNode;
}

/** @deprecated Use `<DocxEditor>` title slots instead. */
export function Logo({ children }: LogoProps) {
  return <div className="flex items-center flex-shrink-0">{children}</div>;
}

// ============================================================================
// DocumentName
// ============================================================================

export interface DocumentNameProps {
  value: string;
  onChange?: (value: string) => void;
  placeholder?: string;
  editable?: boolean;
}

function stripExtension(name: string): string {
  return name.replace(/\.docx$/i, '');
}

/** @deprecated Use `<DocxEditor>` document name slot instead. */
export function DocumentName({ value, onChange, placeholder, editable = true }: DocumentNameProps) {
  const { t } = useTranslation();
  const resolvedPlaceholder = placeholder ?? t('titleBar.untitled');
  const displayName = stripExtension(value) ?? '';

  if (!editable) {
    return (
      <span className="text-base font-normal text-foreground px-2 py-0 min-w-[100px] max-w-[300px] truncate leading-tight">
        {displayName || resolvedPlaceholder}
      </span>
    );
  }
  return (
    <input
      type="text"
      value={displayName}
      onChange={(e) => {
        const raw = e.target.value;
        onChange?.(raw.endsWith('.docx') ? raw : raw + '.docx');
      }}
      placeholder={resolvedPlaceholder}
      className="text-base font-normal text-foreground bg-transparent border-0 outline-none px-2 py-0 rounded hover:bg-muted focus:bg-doc-bg-input focus:ring-1 focus:ring-ring min-w-[100px] max-w-[300px] truncate leading-tight"
      aria-label={t('titleBar.documentNameAriaLabel')}
    />
  );
}

// ============================================================================
// TitleBarRight
// ============================================================================

export interface TitleBarRightProps {
  children: ReactNode;
}

/** @deprecated Use `<DocxEditor>` title slots instead. */
export function TitleBarRight({ children }: TitleBarRightProps) {
  return <div className="flex items-center gap-2 ml-auto flex-shrink-0">{children}</div>;
}

// ============================================================================
// MenuBar
// ============================================================================

/** @deprecated Use `DocxEditor.Menu` from the composition layer instead. */
export function MenuBar() {
  const { t } = useTranslation();
  const ctx = useEditorToolbar();
  const {
    disabled = false,
    onFormat,
    onPrint,
    onOpen,
    onSave,
    onPageSetup,
    onInsertImage,
    onInsertTable,
    showTableInsert = true,
    showHelpMenu = true,
    onInsertPageBreak,
    onInsertSectionBreakNextPage,
    onInsertSectionBreakContinuous,
    onInsertTOC,
    onWatermark,
    onRefocusEditor,
  } = ctx;

  const handleFormat = useCallback(
    (action: FormattingAction) => {
      if (!disabled && onFormat) {
        onFormat(action);
      }
    },
    [disabled, onFormat]
  );

  const handleTableInsert = useCallback(
    (rows: number, columns: number) => {
      if (!disabled && onInsertTable) {
        onInsertTable(rows, columns);
        hostWindowOf(ctx.editorRef?.current).requestAnimationFrame(() => onRefocusEditor?.());
      }
    },
    [disabled, onInsertTable, onRefocusEditor, ctx.editorRef]
  );

  const hasPrintOrPageSetup = !!onPrint || !!onPageSetup;
  const hasFileMenu = hasPrintOrPageSetup || onOpen || onSave;

  return (
    <div className="flex items-center" role="menubar" aria-label={t('titleBar.menuBarAriaLabel')}>
      {/* File Menu */}
      {hasFileMenu && (
        <MenuDropdown
          label={t('toolbar.file')}
          disabled={disabled}
          items={[
            ...(onOpen
              ? [
                  {
                    icon: 'file_upload',
                    label: t('toolbar.open'),
                    shortcut: t('toolbar.openShortcut'),
                    onClick: onOpen,
                  } as MenuEntry,
                ]
              : []),
            ...(onSave
              ? [
                  {
                    icon: 'file_download',
                    label: t('toolbar.save'),
                    shortcut: t('toolbar.saveShortcut'),
                    onClick: onSave,
                  } as MenuEntry,
                ]
              : []),
            ...((onOpen || onSave) && hasPrintOrPageSetup
              ? [{ type: 'separator' as const } as MenuEntry]
              : []),
            ...(onPrint
              ? [
                  {
                    icon: 'print',
                    label: t('toolbar.print'),
                    shortcut: t('toolbar.printShortcut'),
                    onClick: onPrint,
                  } as MenuEntry,
                ]
              : []),
            ...(onPageSetup
              ? [
                  {
                    icon: 'settings',
                    label: t('toolbar.pageSetup'),
                    onClick: onPageSetup,
                  } as MenuEntry,
                ]
              : []),
          ]}
        />
      )}

      {/* Format Menu */}
      <MenuDropdown
        label={t('toolbar.format')}
        disabled={disabled}
        items={[
          {
            icon: 'format_textdirection_l_to_r',
            label: t('toolbar.leftToRight'),
            onClick: () => handleFormat('setLtr'),
          } as MenuEntry,
          {
            icon: 'format_textdirection_r_to_l',
            label: t('toolbar.rightToLeft'),
            onClick: () => handleFormat('setRtl'),
          } as MenuEntry,
        ]}
      />

      {/* Insert Menu */}
      <MenuDropdown
        label={t('toolbar.insert')}
        disabled={disabled}
        items={[
          ...(onInsertImage
            ? [{ icon: 'image', label: t('toolbar.image'), onClick: onInsertImage } as MenuEntry]
            : []),
          ...(showTableInsert && onInsertTable
            ? [
                {
                  icon: 'grid_on',
                  label: t('toolbar.table'),
                  submenuContent: (closeMenu: () => void) => (
                    <TableGridInline
                      onInsert={(rows: number, cols: number) => {
                        handleTableInsert(rows, cols);
                        closeMenu();
                      }}
                    />
                  ),
                } as MenuEntry,
              ]
            : []),
          ...(onInsertImage || (showTableInsert && onInsertTable)
            ? [{ type: 'separator' as const } as MenuEntry]
            : []),
          {
            icon: 'page_break',
            label: t('toolbar.break'),
            submenuContent: (closeMenu: () => void) => (
              <BreakSubmenu
                closeMenu={closeMenu}
                items={[
                  {
                    icon: 'page_break',
                    label: t('toolbar.pageBreak'),
                    onClick: onInsertPageBreak,
                  },
                  {
                    icon: 'horizontal_rule',
                    label: t('toolbar.sectionBreakNextPage'),
                    onClick: onInsertSectionBreakNextPage,
                  },
                  {
                    icon: 'border_horizontal',
                    label: t('toolbar.sectionBreakContinuous'),
                    onClick: onInsertSectionBreakContinuous,
                  },
                ]}
              />
            ),
          } as MenuEntry,
          {
            icon: 'format_list_numbered',
            label: t('toolbar.tableOfContents'),
            onClick: onInsertTOC,
            disabled: !onInsertTOC,
          },
          ...(onWatermark
            ? [
                {
                  icon: 'branding_watermark',
                  label: t('toolbar.watermark'),
                  onClick: onWatermark,
                } as MenuEntry,
              ]
            : []),
        ]}
      />

      {/* Help Menu */}
      {showHelpMenu && (
        <MenuDropdown
          label={t('toolbar.help')}
          disabled={disabled}
          items={[
            {
              label: t('toolbar.reportIssue'),
              onClick: () => openReportIssue(),
            } as MenuEntry,
          ]}
        />
      )}
    </div>
  );
}

// ============================================================================
// TitleBar
// ============================================================================

export interface TitleBarProps {
  children: ReactNode;
}

/**
 * TitleBar layout (Google Docs style):
 *
 *   ┌──────────┬────────────────────────────┬──────────────────┐
 *   │          │ Document Name              │                  │
 *   │  Logo    │                            │  Right Actions   │
 *   │          │ File  Format  Insert       │                  │
 *   └──────────┴────────────────────────────┴──────────────────┘
 *
 * Logo and TitleBarRight span full height. DocumentName + MenuBar
 * stack vertically in the center column.
 */
/** @deprecated Use `<DocxEditor>` from the composition layer instead. */
export function TitleBar({ children }: TitleBarProps) {
  let logoItem: ReactNode = null;
  let rightItem: ReactNode = null;
  const middleTopItems: ReactNode[] = [];
  const menuBarItems: ReactNode[] = [];

  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === Logo) {
      logoItem = child;
    } else if (child.type === TitleBarRight) {
      rightItem = child;
    } else if (child.type === MenuBar) {
      menuBarItems.push(child);
    } else {
      middleTopItems.push(child);
    }
  });

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    const target = e.target as HTMLElement;
    const isInteractive =
      target.tagName === 'INPUT' ||
      target.tagName === 'TEXTAREA' ||
      target.tagName === 'SELECT' ||
      target.tagName === 'OPTION';

    if (!isInteractive) {
      e.preventDefault();
    }
  }, []);

  return (
    <div
      className="flex items-stretch bg-doc-surface pt-2 pb-1"
      onMouseDown={handleMouseDown}
      data-testid="title-bar"
    >
      {/* Left: Logo spanning full height (default doc icon if none provided) */}
      <div className="flex items-center flex-shrink-0 pl-3 pr-1">
        {logoItem || <DefaultDocIcon />}
      </div>

      {/* Center: doc name on top, menus below */}
      <div className="flex flex-col justify-center flex-1 min-w-0 py-1">
        {middleTopItems.length > 0 && (
          <div className="flex items-center gap-2 px-1">{middleTopItems}</div>
        )}
        {menuBarItems.length > 0 && <div className="flex items-center px-1">{menuBarItems}</div>}
      </div>

      {/* Right: actions spanning full height */}
      {rightItem && <div className="flex items-center flex-shrink-0 px-3">{rightItem}</div>}
    </div>
  );
}
