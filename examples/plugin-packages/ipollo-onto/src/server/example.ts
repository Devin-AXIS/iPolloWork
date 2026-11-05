import {
  createProject,
  createTable,
  createField,
  deleteProject,
  getData,
  saveRecord,
} from './store'

export async function createExample() {
  const project = await createProject({
    name: '客户与增长 · 示例',
    description: '一组可编辑的虚构数据，体验表格、字段和双向关联。',
    color: 'green',
  })
  try {
    const customers = await createTable(project.id, {
      name: '客户',
      description: '从第一次联系，到长期合作。',
    })
    const common = { required: false, options: [], multiple: false, inverseMultiple: true }
    const owner = await createField(customers.id, { ...common, name: '负责人', type: 'text' })
    const status = await createField(customers.id, {
      ...common,
      name: '合作阶段',
      type: 'select',
      options: ['合作中', '洽谈中', '待联系'],
    })
    const amount = await createField(customers.id, {
      ...common,
      name: '预计金额',
      type: 'currency',
    })
    const date = await createField(customers.id, { ...common, name: '下次跟进', type: 'date' })
    const progress = await createField(customers.id, {
      ...common,
      name: '推进程度',
      type: 'percentage',
    })
    const customerData = await getData(customers.id)
    const title = customerData.fields[0].id
    const records = []
    const examples = [
      ['青禾设计', '林知', '合作中', '128000', '2026-09-18', '85'],
      ['山海科技', '陈予', '洽谈中', '86000', '2026-09-16', '60'],
      ['有间文化', '林知', '待联系', '35000', '2026-09-21', '20'],
      ['远川制造', '周言', '合作中', '240000', '2026-09-25', '95'],
      ['拾光工作室', '陈予', '洽谈中', '62000', '2026-09-19', '45'],
    ]
    for (const item of examples)
      records.push(
        await saveRecord(customers.id, {
          values: {
            [title]: item[0],
            [owner!.id]: item[1],
            [status!.id]: item[2],
            [amount!.id]: item[3],
            [date!.id]: item[4],
            [progress!.id]: item[5],
          },
        }),
      )
    const opportunities = await createTable(project.id, {
      name: '商机',
      description: '每个机会，都能回到它的客户。',
    })
    const relation = await createField(opportunities.id, {
      ...common,
      name: '客户',
      type: 'relation',
      targetTableId: customers.id,
      reverseName: '相关商机',
    })
    const opportunityData = await getData(opportunities.id)
    await saveRecord(opportunities.id, {
      values: { [opportunityData.fields[0].id]: '品牌设计年度合作', [relation!.id]: [records[0]] },
    })
    await saveRecord(opportunities.id, {
      values: { [opportunityData.fields[0].id]: '业务管理系统试点', [relation!.id]: [records[1]] },
    })
    return { project, tableId: customers.id }
  } catch (error) {
    await deleteProject(project.id)
    throw error
  }
}
