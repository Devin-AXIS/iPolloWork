import type { Blueprint } from './blueprint'

export function exampleBlueprint(projectId?: string): Blueprint {
  return {
    schemaVersion: 1,
    requestId: crypto.randomUUID(),
    project: projectId
      ? { id: projectId }
      : { name: '客户与销售', description: '从结构一次建立业务表和双向关联' },
    tables: [
      {
        key: 'customers',
        name: '客户',
        description: '',
        fields: [
          { key: 'name', name: '客户名称', type: 'text', required: true, options: [] },
          { key: 'email', name: '邮箱', type: 'email', required: false, options: [] },
          { key: 'tags', name: '标签', type: 'tags', required: false, options: [] },
        ],
      },
      {
        key: 'deals',
        name: '商机',
        description: '',
        fields: [
          { key: 'name', name: '商机名称', type: 'text', required: true, options: [] },
          { key: 'amount', name: '预计金额', type: 'currency', required: false, options: [] },
          {
            key: 'status',
            name: '阶段',
            type: 'select',
            required: false,
            options: ['待跟进', '进行中', '已完成'],
          },
        ],
      },
    ],
    relations: [
      {
        from: 'deals',
        to: 'customers',
        key: 'customer',
        name: '客户',
        reverseName: '商机',
        multiple: false,
        inverseMultiple: true,
      },
    ],
  }
}
