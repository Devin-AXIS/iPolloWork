import type {Store} from './database.js';
import {boardMemberEligibility} from './project-board.js';

/** One durable reminder per due instant and current eligible recipient, across service instances. */
export async function deliverBoardReminders(store:Store,now=Date.now()){
  return store.run(`INSERT INTO project_board_notices(id,project_id,task_id,enterprise_id,recipient_id,kind,created_at,due_at)
    SELECT gen_random_uuid()::text,p.id,t.id,p.enterprise_id,r.user_id,'due',?,t.due_at
    FROM project_board_tasks t JOIN projects p ON p.id=t.project_id
    CROSS JOIN LATERAL(SELECT DISTINCT user_id FROM unnest(
      ARRAY[t.assignee_id,t.assignee_agent->>'ownerId']||t.participants||
      ARRAY(SELECT value->>'ownerId' FROM jsonb_array_elements(t.participant_agents))||
      CASE WHEN t.assignee_id IS NULL AND t.assignee_agent IS NULL AND cardinality(t.participants)=0 AND jsonb_array_length(t.participant_agents)=0
        THEN ARRAY[p.owner_id] ELSE '{}'::text[] END
    ) AS person(user_id) WHERE user_id IS NOT NULL) r
    JOIN members m ON m.enterprise_id=p.enterprise_id AND m.user_id=r.user_id
    JOIN "user" u ON u.id=m.user_id AND COALESCE(u.banned,false)=false
    WHERE p.deleted_at IS NULL AND t.people_org_id=p.enterprise_id AND t.deleted_at IS NULL AND NOT t.archived AND t.status<>'done'
      AND t.due_at IS NOT NULL AND t.due_at<=? AND ${boardMemberEligibility}
      AND NOT EXISTS(SELECT 1 FROM project_board_notices n WHERE n.project_id=p.id AND n.task_id=t.id AND n.recipient_id=r.user_id AND n.kind='due' AND n.due_at=t.due_at)
    ORDER BY t.due_at,t.id LIMIT 200 ON CONFLICT DO NOTHING`,now,now);
}
export function boardReminderWorker(store:Store){
  let timer:ReturnType<typeof setInterval>|undefined,pending:Promise<unknown>|undefined,closed=false;
  const tick=()=>{if(!closed&&!pending)pending=deliverBoardReminders(store).catch(()=>{console.warn('project_board_reminder_delivery_failed');}).finally(()=>{pending=undefined;});};
  return {start(){if(!timer){timer=setInterval(tick,30_000);timer.unref();tick();}},async close(){closed=true;if(timer)clearInterval(timer);await pending;}};
}
