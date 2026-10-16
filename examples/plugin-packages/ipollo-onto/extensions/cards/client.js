export function activate({ React, views, components, i18n }) {
  const { translate: tr, useLocale } = i18n
  const h = React.createElement
  const { FieldValue } = components
  function CardsView({ data, onOpen, onAdd }) {
    useLocale()
    const title = data.fields.find((f) => f.isPrimary) ?? data.fields[0]
    const rest = data.fields.filter((f) => f.id !== title?.id)
    return h(
      'div',
      { className: 'record-cards' },
      ...data.records.map((record) =>
        h(
          'button',
          { className: 'record-card', key: record.id, onClick: () => onOpen(record) },
          h(
            'div',
            { className: 'record-card-title' },
            h(
              'span',
              null,
              title
                ? h(FieldValue, { field: title, value: record.values[title.id] })
                : tr('未命名'),
            ),
            h('span', { 'aria-hidden': true }, '↗'),
          ),
          ...rest.slice(0, 5).map((field) =>
            h(
              'div',
              { className: 'record-card-field', key: field.id },
              h('span', null, field.name),
              h(FieldValue, {
                field,
                value: record.values[field.id],
                state: record.dynamic?.[field.id],
              }),
            ),
          ),
        ),
      ),
      h(
        'button',
        { className: 'record-card create-record-card', onClick: onAdd },
        tr('+ 新建记录'),
      ),
    )
  }
  views.register({
    id: 'cards',
    name: '卡片',
    description: '以卡片查看同一份数据',
    icon: components.icons.cards,
    component: CardsView,
  })
}
