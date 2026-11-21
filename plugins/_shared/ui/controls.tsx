import { forwardRef, useEffect, useId, useLayoutEffect, useRef, useState,
  type ComponentPropsWithoutRef, type ReactElement, type ReactNode } from 'react';
import { Button, Input, Menu, Switch } from '@deepseek-ai/dsh-client-ui-primitives';
import { ChevronDown, lineStroke } from './icons.ts';

export { Button, Switch, Tag } from '@deepseek-ai/dsh-client-ui-primitives';

type InputProps = ComponentPropsWithoutRef<typeof Input>;
type ButtonProps = ComponentPropsWithoutRef<typeof Button>;
type TextAreaProps = ComponentPropsWithoutRef<'textarea'>;

export const TextInput = forwardRef<HTMLInputElement, InputProps>(function TextInput({ className = '', ...props }, ref) {
  return <Input {...props} ref={ref} className={'ipw-control ipw-text-input ' + className} />;
});

export function TextArea({ className = '', ...props }: TextAreaProps) {
  return <textarea {...props} className={'ipw-control ipw-text-area ' + className} />;
}

export function FormSelect({ className = '', ...props }: ComponentPropsWithoutRef<'select'>) {
  return <select {...props} className={'ipw-control ipw-form-select ' + className} />;
}

export const FormButton = forwardRef<HTMLButtonElement, ButtonProps>(function FormButton({ variant = 'ghost', className = '', ...props }, ref) {
  return <Button {...props} ref={ref} variant={variant} data-ipw-variant={variant} className={'ipw-form-button ' + className} />;
});

export function SettingSwitch({ label, className = '', ...props }: ComponentPropsWithoutRef<typeof Switch>) {
  return <div className={'ipw-setting-switch ' + className}>
    <span>{label}</span>
    <Switch {...props} label={label} />
  </div>;
}

export function Avatar({ photo, fallback, className = '' }: {
  photo?: string | undefined; fallback: ReactNode; className?: string;
}) {
  const [failed, setFailed] = useState<string>();
  return <span className={'ipw-avatar ' + className} aria-hidden="true">
    {photo && failed !== photo
      ? <img src={photo} alt="" decoding="async" loading="lazy" referrerPolicy="no-referrer" onError={() => setFailed(photo)} />
      : fallback}
  </span>;
}

export function SegmentedControl<Value extends string>({ label, value, options, change, disabled, className = '' }: {
  label: string; value: Value;
  options: readonly { id: Value; label: string; icon?: ReactNode; count?: number; status?: string }[];
  change(value: Value): void; disabled?: boolean; className?: string;
}) {
  return <div className={'ipw-segmented ' + className} role="group" aria-label={label}>
    {options.map(option => <Button key={option.id} size="sm" type="button" className="ipw-segment"
      data-status={option.status} disabled={disabled} aria-pressed={option.id === value} onClick={() => change(option.id)}>
      {option.icon}{option.label}
      {option.count !== undefined && <span className="ipw-segment-count">{option.count}</span>}
    </Button>)}
  </div>;
}

export function FieldPopover({ anchor, width = 'calendar', children }: {
  anchor: string; width?: 'anchor' | 'calendar' | 'time'; children: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const layer = ref.current;
    if (!layer || typeof layer.showPopover !== 'function') return;
    layer.setAttribute('popover', 'manual');
    layer.showPopover();
    return () => { if (layer.matches(':popover-open')) layer.hidePopover(); };
  }, []);
  return <div ref={ref} className="ipw-field-layer"
    data-width={width} style={{ positionAnchor: anchor }}>{children}</div>;
}

export function OptionMenu<Value extends string>({ label, value, choices, change, disabled, glyph, iconClassName, menuClassName,
  placeholder, scrollToValue = false, inlineTime = false, buttonRef }: {
  label: string; value: Value; choices: readonly { id: Value; label: string; disabled?: boolean }[];
  change(value: Value): void; disabled?: boolean; glyph?: ReactElement;
  iconClassName?: string; menuClassName?: string;
  placeholder?: string; scrollToValue?: boolean; inlineTime?: boolean;
  buttonRef?: { current: HTMLButtonElement | null } | undefined;
}) {
  const id = useId();
  const anchor = '--ipw-option-' + id.replaceAll(':', '');
  const trigger = useRef<HTMLButtonElement | null>(null);
  const selected = useRef<HTMLSpanElement>(null);
  const [open, setOpen] = useState(false);
  const current = choices.find(choice => choice.id === value)?.label ?? placeholder;
  const shown = open && !disabled;
  useEffect(() => {
    if (!shown || !scrollToValue) return;
    const row = selected.current?.closest('button');
    row?.focus({ preventScroll: true });
    row?.scrollIntoView({ block: 'center' });
  }, [shown, scrollToValue]);
  const button = <Button ref={node => {
    trigger.current = node;
    if (buttonRef) buttonRef.current = node;
  }} type="button" variant="ghost"
    style={glyph ? undefined : { anchorName: anchor }}
    className={glyph ? iconClassName : inlineTime ? 'ipw-inline-time' : 'ipw-control ipw-select-trigger'}
    data-empty={inlineTime && !value ? '' : undefined}
    disabled={disabled} aria-label={glyph || !current ? label : `${label} · ${current}`}
    aria-haspopup="menu" aria-expanded={shown}
    onClick={() => setOpen(current => !current)}>
    {glyph ?? <><span>{current}</span>{!inlineTime && <ChevronDown size={13} strokeWidth={lineStroke} aria-hidden="true" />}</>}
  </Button>;
  const props = {
    compact: true,
    autoFocus: !scrollToValue || !value,
    open: shown,
    items: choices.map(choice => scrollToValue && choice.id === value
      ? { ...choice, label: <span ref={selected}>{choice.label}</span> } : choice),
    selectedId: value,
    onClose: () => setOpen(false),
    onSelect: (id: string) => {
      setOpen(false);
      const choice = choices.find(item => item.id === id);
      if (choice && !choice.disabled && choice.id !== value) change(choice.id);
    },
  };
  if (glyph) return <Menu {...props} className={menuClassName} align="end" portal anchor={button} />;
  return <div className="ipw-field-menu">
    {button}
    {shown && <FieldPopover anchor={anchor} width={inlineTime ? 'time' : 'anchor'}>
      <Menu {...props} className="ipw-menu-body" listClassName="ipw-field-options" anchorRef={trigger} anchor={null} />
    </FieldPopover>}
  </div>;
}
