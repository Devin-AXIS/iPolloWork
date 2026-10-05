/* Business diagrams — map flat HyperFrames variables (strings/numbers) to diagram data.
 * List syntax shared by every block: items separated by "|", fields by "::", sub-items by "," "，" or "、",
 * and an optional icon suffix "@icon" on any label (built-in name, SVG path or image URL). */
(() => {
  const SD = window.StageDiagrams;
  const list = v => String(v ?? '').split('|').map(x => x.trim()).filter(Boolean);
  const fields = v => v.split('::').map(x => x.trim());
  const subs = v => String(v ?? '').split(/[,，、]/).map(x => x.trim()).filter(Boolean);
  /** "label@icon" → { label, icon } */
  const labelled = v => {
    const m = /^(.*?)@([^@]+)$/.exec(String(v ?? '').trim());
    return m ? { label: m[1].trim(), icon: m[2].trim() } : { label: String(v ?? '').trim() };
  };
  const highlighted = (values, label, index) => {
    const h = values.highlight;
    if (typeof h === 'number') return h === index + 1;
    return subs(h).includes(label);
  };

  SD.fromVariables = {
    mindmap: v => ({
      ...labelledCenter(v),
      reveal: v.reveal || 'branch',
      branches: list(v.branches).map((row, i) => {
        const [head, items = ''] = fields(row), b = labelled(head);
        return { ...b, items: subs(items).map(labelled), hl: highlighted(v, b.label, i) };
      }),
    }),
    timeline: v => ({
      items: list(v.items).map((row, i) => {
        const [date, head, desc] = fields(row), t = labelled(head);
        return { date, title: t.label, icon: t.icon, desc, hl: v.current === i + 1 };
      }),
    }),
    architecture: v => ({
      layers: list(v.layers).map((row, i) => {
        const [head, nodes = ''] = fields(row), l = labelled(head);
        const hl = subs(v.emphasis);
        return { ...l, hl: hl.includes(l.label), nodes: subs(nodes).map(labelled).map(n => ({ ...n, hl: hl.includes(n.label) })) };
      }),
      links: subs(v.links).map(pair => pair.split('>').map(x => x.trim())).filter(p => p.length === 2 && p[0] && p[1]),
    }),
  };
  function labelledCenter(v) {
    const c = labelled(v.center);
    return { center: c.label, icon: c.icon || v.centerIcon, sub: v.centerSub };
  }
})();
