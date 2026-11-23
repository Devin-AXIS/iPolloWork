export function activate({ fields }) {
  fields.register({
    id: 'percentage',
    label: '百分比',
    category: 'extended',
    storage: 'numeric',
    input: 'number',
    validate(value) {
      const parsed = fields.get('number').validate(value, { name: '百分比', options: [] })
      if (Number(parsed) < 0 || Number(parsed) > 100) throw new Error('百分比需要在 0 到 100 之间')
      return parsed
    },
    format: (value) => (value == null ? '' : `${value}%`),
  })
}
