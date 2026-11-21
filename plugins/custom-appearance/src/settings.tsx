import { useRef, useState } from 'react';
import { ImagePlus } from 'lucide-react';
import { FormButton, SegmentedControl, TextInput } from '../../_shared/ui/controls.tsx';
import { buttonInk, choices, defaultPalette, maxLogoBytes, maxLogoSide, maxName, modes, presets, roles,
  validColor, type Appearance, type Change, type Mode, type Palette, type Role } from './model.ts';
import type { Copy } from './copy.ts';

export type View = { state: 'loading' | 'error' } | { state: 'ready'; profile: Appearance };
export interface SettingsProps {
  useAppearance<T>(select: (value: View) => T): T;
  useLabels<T>(select: (value: Copy) => T): T;
  save(change: Change): Promise<void>;
  reload(): void;
  logoUrl(revision: number): string;
}

async function prepareLogo(file: File): Promise<string> {
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type) || file.size > 16 * 1024 * 1024)
    throw new Error('logo');
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    if (!image.naturalWidth || !image.naturalHeight) throw new Error('logo');
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('logo');
    for (const side of [maxLogoSide, 256, 192]) {
      const scale = Math.min(1, side / Math.max(image.naturalWidth, image.naturalHeight));
      canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
      canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      const data = canvas.toDataURL('image/png');
      const encoded = data.slice('data:image/png;base64,'.length);
      if (encoded && atob(encoded).length <= maxLogoBytes) return encoded;
    }
    throw new Error('logo');
  } finally { URL.revokeObjectURL(source); }
}

export function Settings({ useAppearance, useLabels, save, reload, logoUrl }: SettingsProps) {
  const view = useAppearance(value => value);
  const t = useLabels(value => value);
  const [mode, setMode] = useState<Mode>('light');
  const [name, setName] = useState<string>();
  const [logo, setLogo] = useState<string | null>();
  const [custom, setCustom] = useState<Palette>();
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ label: string; failed?: true }>();
  const file = useRef<HTMLInputElement>(null);
  const pending = useRef(false);
  const profile = view.state === 'ready' ? view.profile : undefined;
  const storedColors = profile?.custom ?? defaultPalette;
  const draft = custom ?? storedColors;
  const active = profile?.active ?? 'default';
  const preview = draft[mode];
  const previewColors = Object.fromEntries(roles.map(role => [
    role, validColor(preview[role]) ? preview[role] : storedColors[mode][role],
  ])) as Palette[Mode];
  const brandName = name ?? profile?.name ?? '';
  const previewLogo = logo === null ? undefined : logo ? 'data:image/png;base64,' + logo
    : profile?.hasLogo ? logoUrl(profile.revision) : undefined;

  const apply = async (change: Change) => {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setMessage(undefined);
    try {
      await save(change);
      if (change.action === 'save') { setName(undefined); setLogo(undefined); setCustom(undefined); }
      setMessage({ label: t.saved });
    } catch (error) {
      const label = error instanceof Error && error.message === 'changed' ? t.changed
        : error instanceof Error && error.message === 'invalid' ? t.invalid : t.failed;
      setMessage({ label, failed: true });
    } finally { pending.current = false; setBusy(false); }
  };
  function color(role: Role, value: string) {
    setMessage(undefined);
    setCustom(previous => {
      const base = previous ?? storedColors;
      return { ...base, [mode]: { ...base[mode], [role]: value } };
    });
  }

  return <section className="ipa-settings">
    <h2>{t.header}</h2>
    {view.state === 'loading' && <p role="status">{t.loading}</p>}
    {view.state === 'error' && <p role="alert">{t.unavailable} <FormButton size="sm" onClick={reload}>{t.retry}</FormButton></p>}
    {profile && <form onSubmit={event => {
      event.preventDefault();
      if (!modes.every(mode => roles.every(role => validColor(draft[mode][role])))) {
        setMessage({ label: t.invalid, failed: true });
        return;
      }
      void apply({ action: 'save', revision: profile.revision, name: brandName, custom: draft, useCustom: Boolean(custom),
        ...(logo === undefined ? {} : { logo }) });
    }}>
      <section className="ipa-group" aria-label={t.brand}>
        <h3>{t.brand}</h3>
        <div className="ipa-brand-fields">
          <div className="ipa-logo-control">
            <span className="ipa-logo-box">
              {previewLogo ? <img src={previewLogo} alt={t.logo} /> : <ImagePlus size={19} strokeWidth={1.6} aria-hidden />}
            </span>
            <div className="ipa-logo-actions">
              <input ref={file} type="file" accept="image/png,image/jpeg,image/webp" hidden aria-label={t.logo}
                onChange={event => {
                  const selected = event.currentTarget.files?.[0];
                  event.currentTarget.value = '';
                  if (!selected || pending.current) return;
                  pending.current = true;
                  setBusy(true);
                  setMessage(undefined);
                  void prepareLogo(selected).then(setLogo, () => setMessage({ label: t.logoError, failed: true }))
                    .finally(() => { pending.current = false; setBusy(false); });
                }} />
              <FormButton size="sm" variant="outline" disabled={busy} onClick={() => file.current?.click()}>{t.upload}</FormButton>
              {previewLogo && <FormButton size="sm" disabled={busy} onClick={() => setLogo(null)}>{t.removeLogo}</FormButton>}
            </div>
          </div>
          <label className="ipa-field">{t.name}
            <TextInput aria-label={t.name} placeholder={t.namePlaceholder} maxLength={maxName} disabled={busy}
              value={brandName} onChange={event => { setName(event.target.value); setMessage(undefined); }} />
          </label>
        </div>
      </section>
      <section className="ipa-group" aria-label={t.skins}>
        <h3>{t.skins}</h3>
        <div className="ipa-presets">
          {choices.map(choice => {
            const sample = (choice === 'custom' ? profile.custom : presets[choice]).light;
            return <button key={choice} className="ipa-preset" type="button" aria-pressed={active === choice}
              disabled={busy} onClick={() => void apply({ action: 'activate', active: choice })}>
              <span className="ipa-preset-swatch" aria-hidden>
                {[sample.background, sample.secondary, sample.primary].map((color, index) => <i key={index} style={{ backgroundColor: color }} />)}
              </span>
              <span>{t.choices[choice]}</span>
            </button>;
          })}
        </div>
      </section>
      <section className="ipa-group" aria-label={t.colors}>
        <header className="ipa-colors-heading">
          <h3>{t.colors}</h3>
          <SegmentedControl<Mode> label={t.editMode} value={mode} options={modes.map(id => ({ id, label: t.modes[id] }))} change={setMode} />
        </header>
        <div className="ipa-colors-body">
          <div className="ipa-colors">
            {roles.map(role => <div key={role} className="ipa-color">
              <span>{t.roles[role]}</span>
              <div className="ipa-color-values">
                <input type="color" aria-label={t.roles[role]} disabled={busy}
                  value={validColor(draft[mode][role]) ? draft[mode][role] : storedColors[mode][role]}
                  onChange={event => color(role, event.target.value)} />
                <TextInput aria-label={t.roles[role] + ' HEX'} value={draft[mode][role]} disabled={busy}
                  spellCheck={false} maxLength={7} onChange={event => color(role, event.target.value)} />
              </div>
            </div>)}
          </div>
          <div className="ipa-preview" aria-label={t.preview} style={{ backgroundColor: previewColors.background, color: previewColors.text }}>
            <div className="ipa-preview-sidebar" aria-hidden style={{ backgroundColor: previewColors.secondary }} />
            <div className="ipa-preview-main">
              <span>{t.preview}</span>
              <strong title={brandName}>{brandName || 'iPolloWork'}</strong>
              <span className="ipa-demo-button" style={{ backgroundColor: previewColors.primary, color: buttonInk(previewColors.primary) }}>
                {t.sampleButton}
              </span>
            </div>
          </div>
        </div>
      </section>
      <footer className="ipa-save">
        <p role={message?.failed ? 'alert' : 'status'}>{message?.label}</p>
        <FormButton variant="primary" type="submit" disabled={busy || (name === undefined && logo === undefined && !custom)}>{t.apply}</FormButton>
      </footer>
    </form>}
  </section>;
}
