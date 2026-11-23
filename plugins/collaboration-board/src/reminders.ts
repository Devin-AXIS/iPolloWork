import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import type {BoardNotice,ProjectTask} from '../../../services/ipollowork/src/project-board-contract.ts';
import {localCards,projectTask,type TaskTable} from './tasks.ts';
export const personalReminder=z.object({workspace:z.string(),taskId:z.uuid(),dueAt:z.number(),createdAt:z.number(),read:z.boolean()});
export type PersonalReminder=z.infer<typeof personalReminder>;
export interface ReminderTable {get(id:string):PersonalReminder|undefined;put(id:string,value:PersonalReminder):Promise<void>;entries():IterableIterator<[string,PersonalReminder]>}
export const dueReminderActive=(task:ProjectTask,dueAt:number)=>!task.archived&&task.deletedAt==null&&task.status!=='done'&&task.dueAt===dueAt;
export async function refreshPersonalReminders(table:ReminderTable,tasks:TaskTable,workspaces:ReadonlyMap<string,string>,now=Date.now()){
  const known=new Set([...table.entries()].map(([,item])=>JSON.stringify([item.workspace,item.taskId,item.dueAt])));
  let created=0;
  for(const [workspace] of workspaces){
    const cards=localCards(tasks,workspace);
    for(const item of cards.values()){
      const task=projectTask(item,cards),key=JSON.stringify([workspace,item.id,task.dueAt]);
      if(task.dueAt===null||task.dueAt>now||!dueReminderActive(task,task.dueAt)||known.has(key)||created>=200)continue;
      await table.put(randomUUID(),{workspace,taskId:item.id,dueAt:task.dueAt,createdAt:now,read:false});known.add(key);created++;
    }
  }
  const notices:BoardNotice[]=[];
  for(const [id,item] of table.entries()){
    if(!workspaces.has(item.workspace))continue;
    const cards=localCards(tasks,item.workspace),record=cards.get(item.taskId),task=record&&projectTask(record,cards);
    if(task&&dueReminderActive(task,item.dueAt))notices.push({id,projectId:item.workspace,projectTitle:workspaces.get(item.workspace)!,taskId:task.id,title:task.title,kind:'due',createdAt:item.createdAt,read:item.read});
  }
  return notices.sort((a,b)=>b.createdAt-a.createdAt).slice(0,200);
}
