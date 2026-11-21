const en = {
  header: 'Custom appearance', brand: 'Brand', skins: 'Skins', colors: 'Custom colors',
  name: 'App name', namePlaceholder: 'Use the original app name',
  logo: 'Logo', upload: 'Upload logo', removeLogo: 'Remove logo',
  apply: 'Save appearance', saved: 'Appearance saved', retry: 'Retry', loading: 'Loading appearance…',
  modes: { light: 'Light', dark: 'Dark' }, editMode: 'Color mode to edit',
  choices: { default: 'Default', ocean: 'Ocean', forest: 'Forest', violet: 'Violet', custom: 'My skin' },
  roles: { primary: 'Primary', secondary: 'Secondary', text: 'Text', background: 'Background' },
  preview: 'Preview', sampleButton: 'Primary button', headline: 'Turn ideas into outcomes',
  logoError: 'Choose a PNG, JPEG, or WebP image that can be opened.',
  invalid: 'Use six-digit HEX colors and a name of up to 48 characters.',
  changed: 'Appearance changed in another tab. Review and save again.',
  failed: 'Appearance could not be saved. Try again.',
  unavailable: 'Appearance settings are unavailable.',
};
const zh: typeof en = {
  header: '自定义外观', brand: '应用品牌', skins: '皮肤', colors: '自定义配色',
  name: '应用名称', namePlaceholder: '使用原来的应用名称',
  logo: 'Logo', upload: '上传 Logo', removeLogo: '移除 Logo',
  apply: '保存外观', saved: '外观已保存', retry: '重试', loading: '正在读取外观…',
  modes: { light: '浅色', dark: '深色' }, editMode: '配色模式',
  choices: { default: '套件默认', ocean: '海盐', forest: '松林', violet: '暮紫', custom: '我的皮肤' },
  roles: { primary: '主题色', secondary: '辅助色', text: '文字颜色', background: '背景颜色' },
  preview: '预览', sampleButton: '主要按钮', headline: '把想法变成成果',
  logoError: '请选择可打开的 PNG、JPEG 或 WebP 图片',
  invalid: '颜色需填写六位 HEX，应用名称最多 48 个字符',
  changed: '外观已在另一标签页更新，请查看后再保存',
  failed: '外观保存失败，请重试',
  unavailable: '暂时无法读取外观设置',
};
export type Copy = typeof en;
export function copy(language: string) { return language.toLowerCase().startsWith('zh') ? zh : en; }
