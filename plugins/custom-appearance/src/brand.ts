import { brandAttribute, logoAttribute, logoPath } from './model.ts';

const wordmark = '[data-dsh-boot]>div>div:first-child';
const escapeHtml = (value: string) => value.replace(/[&<>"']/g, character =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[character]!);

export function appearanceIndex(html: string, name: string, hasLogo: boolean, revision: number) {
  const url = logoPath + '?v=' + revision;
  let additions = '';
  if (name) {
    const title = escapeHtml(name);
    html = html.replace(/<html(?=[\s>])/, () => '<html ' + brandAttribute + '="' + title + '"')
      .replace(/<title>[^<]*<\/title>/, () => '<title>' + title + '</title>')
      .replace(/(<meta name="apple-mobile-web-app-title" content=")[^"]*(")/, (_full, start, end) => start + title + end);
    const text = JSON.stringify(name).replaceAll('<', '\\3c ');
    additions += '<style>' + wordmark + '{font-size:0!important;line-height:0}' + wordmark
      + '::after{content:' + text + '!important;font-size:17px;line-height:24px;font-weight:600;display:block}</style>';
  }
  if (hasLogo) {
    html = html.replace(/<link rel="(?:icon|apple-touch-icon)"[^>]*>\s*/g, '');
    additions += '<link ' + logoAttribute + ' rel="icon" type="image/png" href="' + url + '">'
      + '<link ' + logoAttribute + ' rel="apple-touch-icon" href="' + url + '">'
      + '<style>' + wordmark + '::before{content:"";display:block;width:36px;height:36px;margin:auto;'
      + 'background:transparent url(' + url + ') center/contain no-repeat!important;mask:none!important;-webkit-mask:none!important}</style>';
  }
  return additions ? html.replace('</head>', () => additions + '</head>') : html;
}

export function titled(title: string, prior: string, next: string) {
  if (prior && title === prior) return next;
  if (prior && title.endsWith(' — ' + prior)) return title.slice(0, -prior.length) + next;
  const delimiter = title.lastIndexOf(' — ');
  const suffix = title.slice(delimiter < 0 ? 0 : delimiter + 3);
  const known = /^(?:iPolloWork|DeepSeek Harness|DSH\b.*)$/u.test(suffix);
  return delimiter < 0 || known ? (delimiter < 0 ? '' : title.slice(0, delimiter + 3)) + next : title;
}
