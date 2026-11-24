// Shared canonical table reads and mutation planning; both host lanes use one implementation.
export {
  tableNodes,
  tableRead,
  tableCellRead,
  planTableMutation,
  planInsertTable,
  type AutomationTableMutation,
  type AutomationTableRead,
  type AutomationTableCellRead,
  type TableMutationPlan,
} from '../store/store/table-authoring-plan.ts';
