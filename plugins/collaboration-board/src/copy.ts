const zh = {
  personalScope:'个人项目', organizationScope:'组织项目', connectOrganization:'设置项目归属', inviteProject:'邀请成员',
  projectPeople:'{count} 位项目成员', search:'搜索任务', clearSearch:'清除搜索', noMatches:'没有匹配的任务', noOptions:'没有匹配的选项',
  collaborators:'协作成员', addAI:'参与 AI', lead:'主负责人', makeLead:'设为主负责人', clearLead:'取消主负责人',
  choosePredecessors:'关联前置任务', searchPeople:'搜索姓名或邮箱', searchAI:'搜索 AI',
  noPredecessors:'项目中暂无其他可关联的任务', removeChoice:'移除 {name}', viewMode:'任务视图', columnStatus:'按状态显示',
  taskTotals:'{total} 项任务 · {done} 项完成', addInStatus:'在「{status}」新增任务', changeStatus:'更改「{name}」的状态',
  partialTasks:'仅显示已加载的任务；搜索、统计和各视图暂不包含未加载的任务。可继续加载更多。',
  partialGlobal:'搜索和统计覆盖全部匹配任务；当前视图只展示已加载卡片，可继续加载更多。',
  taskScope:'任务范围',activeTasks:'当前任务',archivedTasks:'已归档',archive:'归档',unarchive:'取消归档',
  taskInactive:'请先取消归档，再编辑或执行任务。',serverUpgradeRequired:'组织服务需要升级后才能使用全量搜索和归档。',dueNotice:'任务已到截止时间',
  deferredStart:'到时若仍被前置任务阻塞，将在前置任务完成后补启动。需要当前应用和 AI 保持可用。',
  emptyLane:'暂无任务', close:'关闭', optionalDescription:'添加任务说明…', taskPlaceholder:'输入任务名称',
  datePart:'{label} · 日期', pickDate:'选择{label}', startTime:'开始时间', dueTime:'截止时间', timeFrom:'开始', timeTo:'截止', timeRange:'起止时间', clearSchedule:'清除起止时间', clearDateTime:'清除{label}和时间', customTime:'自定义时间', applyTime:'应用时间',
  editProperties:'任务属性', doneChoosing:'完成选择', unreadCount:'{count} 条未读',
  newTask:'新增任务', details:'任务详情', titleField:'任务名称', description:'任务说明', priority:'优先级',
  normal:'普通', high:'高', urgent:'紧急', participants:'参与人', predecessors:'前置任务',
  waiting:'等待前置任务', ready:'可以开始', overdue:'已逾期', remaining:'剩余', day:'天', hour:'小时', minute:'分钟',
  notices:'任务通知', noNotices:'暂无任务通知', assignedNotice:'分配给了你', participatingNotice:'邀请你参与',
  readyNotice:'前置任务已完成，可以开始', markRead:'标为已读', more:'加载更多', ai:'复制自动化指令', delegate:'交给 AI', saveAndDelegate:'保存并交给 AI',
  memberTag:'同属成员', aiGroup:'AI', currentAI:'当前对话 AI', nativeDelegate:'原生委派', agentUnavailableShort:'当前不可用',
  canViewConversation:'可查看当前对话', grantConversation:'允许所选成员查看当前对话', grantPending:'正在授权…',
  grantTarget:'只读分享「{title}」', copyConversation:'复制对话链接', grantFailed:'暂时无法授权查看对话，请重试。',
  agentUnavailable:'所选智能体在当前账号或设备上无法运行，请确认它已启用，或改选当前对话 AI。',
  aiWork:'用 ipollo_project_tasks 的 get 读取任务 {id}。如果任务已完成、被前置任务阻塞、尚未到开始时间，或 ai.unavailable 为 true，请停止。如果任务已经委派并在执行，请等结果。准备好后，用最新 revision 将任务置为进行中。若 ai.delegates 有专员，用 ipollo_delegate 按列表中的 agent_preset 分派。若 ai.external 有原生委派，调用每项明确指定的 tool，使用当前项目工作目录，在 prompt 提供任务名称、说明及完成任务所需的信息。只调用 get 当前返回的工具，等待并汇总实际结果。工具不可用或委派失败时，报告错误并停止，避免换用其他智能体。仅在两个列表都为空时在当前对话执行。如果 ai.humanLead 为 true，请回传成果，由负责人确认进度和验收。AI 负责的任务在验收完成后再标记已完成。',
  aiPresets:'此次已选择的专员 preset 为 {presets}，以 get 返回的可用专员为准。',
  aiExternal:'此次已选择的原生委派为 {tools}，以 get 返回的工具和可用性为准。',
  scheduleInstructions:'请先询问我运行时间或频率，经我确认后，用 schedule_create 将以下指令安排到当前项目对话。任务完成后停止该任务的后续自动执行。',
  autoStart:'保存后，AI 将在设定时间自动启动。', scheduled:'已安排 AI 定时启动',
  scheduleSaveFailed:'任务已保存，但定时设置未同步。请重新打开任务并保存重试。',
  aiUnavailable:'当前对话无法接收 AI 任务，请检查 Agent 状态。', tooEarly:'尚未到任务的开始时间。', taskDone:'任务已完成。',
  copied:'已复制', noPeople:'暂无可选成员', needsWrite:'此组织项目当前为只读。',
  taskBlocked:'前置任务尚未完成，任务须停留在待处理。', cycle:'前置任务不能形成循环。',
  dependentStarted:'后续任务已经开始，不能重新打开此任务。', missingPredecessor:'前置任务已不存在。',
  unavailableTasks:'项目任务服务暂不可用。',
  title: '项目看板', noProject: '此对话尚未归入项目。', empty: '暂无任务。点击「新增任务」开始。',
  board: '看板', list: '列表', calendar: '日历', timeline: '时间线',
  todo: '待处理', doing: '进行中', review: '待验收', done: '已完成', active: 'Agent 执行中',
  name: '任务', start: '开始日期', due: '截止日期', status: '进度', dates: '排期', unscheduled: '未排期',
  assignee: '负责人', unassigned: '未分配', rosterUnavailable: '暂时无法读取组织成员，请检查账户和项目权限。',
  assigneeUnavailable: '该成员已不可分配，请重新选择。',
  editor: '编辑对话进度', edit: '编辑进度', auto: '跟随对话状态', save: '保存', cancel: '取消', open: '打开对话',
  today: '今天', previous: '上一周期', next: '下一周期', noDates: '这个日期范围内没有已排期的任务。',
  loading: '正在加载看板…', failed: '暂时无法读取或保存看板。', retry: '重试',
  conflict: '进度刚刚被修改，请关闭后重新打开。', invalid: '请检查日期，截止日期需在开始日期当天或之后。',
  weekdays: ['周一', '周二', '周三', '周四', '周五', '周六', '周日'],
};
const en: typeof zh = {
  personalScope:'Personal project', organizationScope:'Organization project', connectOrganization:'Set project ownership', inviteProject:'Invite members',
  projectPeople:'{count} project members', search:'Search tasks', clearSearch:'Clear search', noMatches:'No matching tasks', noOptions:'No matching options',
  collaborators:'Collaborators', addAI:'Add AI', lead:'Lead', makeLead:'Make lead', clearLead:'Clear lead',
  choosePredecessors:'Link predecessors', searchPeople:'Search names or emails', searchAI:'Search AI',
  noPredecessors:'No other tasks to link in this project', removeChoice:'Remove {name}', viewMode:'Task views', columnStatus:'Show by status',
  taskTotals:'{total} tasks · {done} completed', addInStatus:'Add task in {status}', changeStatus:'Change status of {name}',
  partialTasks:'Only loaded tasks appear in search, totals and views. Load more to include the remaining tasks.',
  partialGlobal:'Search and totals cover all matching tasks. Load more to show the remaining cards in this view.',
  taskScope:'Task scope',activeTasks:'Current tasks',archivedTasks:'Archived',archive:'Archive',unarchive:'Unarchive',
  taskInactive:'Unarchive this task before editing or running it.',serverUpgradeRequired:'Update the organization service to enable full search and archives.',dueNotice:'The task has reached its deadline',
  deferredStart:'If predecessors still block the scheduled start, it will resume after they finish. Keep this app and the selected AI available.',
  emptyLane:'No tasks', close:'Close', optionalDescription:'Add a description…', taskPlaceholder:'Enter task title',
  datePart:'{label} · Date', pickDate:'Choose {label}', startTime:'Start time', dueTime:'Due time', timeFrom:'Start', timeTo:'Due', timeRange:'Time range', clearSchedule:'Clear start and due time', clearDateTime:'Clear {label} and time', customTime:'Custom time', applyTime:'Apply time',
  editProperties:'Properties', doneChoosing:'Done choosing', unreadCount:'{count} unread',
  newTask:'New task', details:'Task details', titleField:'Title', description:'Description', priority:'Priority',
  normal:'Normal', high:'High', urgent:'Urgent', participants:'Participants', predecessors:'Predecessors',
  waiting:'Waiting for predecessors', ready:'Ready to start', overdue:'Overdue', remaining:'Due in', day:'d', hour:'h', minute:'m',
  notices:'Task notifications', noNotices:'No task notifications', assignedNotice:'Assigned to you', participatingNotice:'You were added as a participant',
  readyNotice:'Predecessors complete; ready to start', markRead:'Mark as read', more:'Load more', ai:'Copy automation instructions', delegate:'Send to AI', saveAndDelegate:'Save and send to AI',
  memberTag:'Project member', aiGroup:'AI', currentAI:'Current conversation AI', nativeDelegate:'Native delegation', agentUnavailableShort:'Unavailable here',
  canViewConversation:'Can view this conversation', grantConversation:'Let selected members view this conversation', grantPending:'Granting access…',
  grantTarget:'Share “{title}” with view-only access', copyConversation:'Copy conversation link', grantFailed:'Could not grant conversation access. Try again.',
  agentUnavailable:'The selected agent is unavailable for this account or device. Enable it or choose the current conversation AI.',
  aiWork:'Call ipollo_project_tasks get for task {id}. Stop if done, blocked, before start time or ai.unavailable. Wait for results if it is already delegated. When ready, mark it started using the latest revision. Use ipollo_delegate with each listed agent_preset in ai.delegates. For each ai.external entry, call its exact tool in the project working directory with a prompt containing the title, description, and information needed to do the task. Use only the tools currently returned by get, wait for their actual results, and summarize them. If a tool is unavailable or fails, report the error and stop. Work in this conversation only when both lists are empty. If ai.humanLead is true, return the result for the human assignee to review and let them mark it complete. For AI-owned tasks, mark done after verifying the result.',
  aiPresets:'Selected specialist presets are {presets}. Use the available specialists returned by get.',
  aiExternal:'Selected native delegates are {tools}. Use the tool names and availability returned by get.',
  scheduleInstructions:'Ask me for the timing first. After I confirm, use schedule_create to deliver the instruction below to this project conversation. Stop future runs of the task once it is complete.',
  autoStart:'Save to have AI start at the selected time.', scheduled:'AI start scheduled',
  scheduleSaveFailed:'The task was saved, but its schedule could not be synced. Reopen and save the task to retry.',
  aiUnavailable:'The conversation could not accept the AI task. Check the agent status.', tooEarly:'The scheduled start time has not arrived.', taskDone:'This task is already done.',
  copied:'Copied', noPeople:'No available members', needsWrite:'This organization project is read-only.',
  taskBlocked:'This task must stay in To do until its predecessors finish.', cycle:'Predecessors cannot form a cycle.',
  dependentStarted:'A dependent task has already started. This task cannot be reopened.', missingPredecessor:'A predecessor no longer exists.',
  unavailableTasks:'Project tasks are temporarily unavailable.',
  title: 'Project board', noProject: 'This conversation has no project workspace.', empty: 'No tasks yet. Select New task to get started.',
  board: 'Board', list: 'List', calendar: 'Calendar', timeline: 'Timeline',
  todo: 'To do', doing: 'In progress', review: 'In review', done: 'Done', active: 'Agent running',
  name: 'Task', start: 'Start date', due: 'Due date', status: 'Progress', dates: 'Schedule', unscheduled: 'Unscheduled',
  assignee: 'Assignee', unassigned: 'Unassigned', rosterUnavailable: 'Organization members are unavailable. Check your account and project access.',
  assigneeUnavailable: 'This member is no longer available. Choose another.',
  editor: 'Edit conversation progress', edit: 'Edit progress', auto: 'Follow conversation status', save: 'Save', cancel: 'Cancel', open: 'Open conversation',
  today: 'Today', previous: 'Previous period', next: 'Next period', noDates: 'No scheduled tasks in this date range.',
  loading: 'Loading project board…', failed: 'The project board is temporarily unavailable.', retry: 'Retry',
  conflict: 'Progress changed. Close and reopen this editor.', invalid: 'Check that the due date is on or after the start date.',
  weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
};
export type Copy = typeof zh;
export const copyFor = (locale: string) => locale.toLowerCase().startsWith('zh') ? zh : en;
export function errorMessage(error: unknown, t: Copy): string {
  const code = error instanceof Error ? error.message : '';
  if (code === 'BOARD_SHARE_UNAVAILABLE') return t.grantFailed;
  if (code === 'BOARD_AGENT_UNAVAILABLE') return t.agentUnavailable;
  if (code === 'BOARD_AI_UNAVAILABLE') return t.aiUnavailable;
  if (code === 'BOARD_TASK_NOT_STARTED') return t.tooEarly;
  if (code === 'BOARD_TASK_DONE') return t.taskDone;
  if (code === 'BOARD_TASK_BLOCKED') return t.taskBlocked;
  if (code === 'BOARD_DEPENDENCY_CYCLE') return t.cycle;
  if(code==='BOARD_TASK_INACTIVE')return t.taskInactive;
  if (code === 'BOARD_DEPENDENT_STARTED') return t.dependentStarted;
  if (code === 'BOARD_PREDECESSOR_NOT_FOUND') return t.missingPredecessor;
  if (code === 'BOARD_WRITE_FORBIDDEN') return t.needsWrite;
  if (code === 'BOARD_SERVICE_UNAVAILABLE' || code === 'IPW_ACCOUNT_UNAVAILABLE') return t.unavailableTasks;
  if (code === 'BOARD_ASSIGNEE_UNAVAILABLE') return t.assigneeUnavailable;
  if (code === 'conflict' || code === 'BOARD_CONFLICT') return t.conflict;
  if (code === 'roster_unavailable') return t.rosterUnavailable;
  if (code === 'assignee_unavailable') return t.assigneeUnavailable;
  if (code === 'invalid_note') return t.invalid;
  return t.failed;
}
