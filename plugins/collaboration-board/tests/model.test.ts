import assert from 'node:assert/strict';
import test from 'node:test';
import { avatarInitial } from '../src/avatar-initial.ts';
import { assigneeName, collaboratorKey, dateRange, dayOffset, projectCards, shiftDay, shiftMonth, span, taskCollaborators,
  taskDefaults, timelinePosition, updateCollaborator } from '../src/model.ts';

test('calendar starts on Monday and reaches the following month without timezone drift', () => {
  assert.deepEqual(dateRange('calendar', '2026-11-18'), { from: '2026-10-26', to: '2026-12-06' });
  assert.equal(shiftMonth('2026-03-31', -1), '2026-02-01');
  assert.equal(shiftDay('2024-02-28', 1), '2024-02-29');
  assert.equal(dayOffset('2026-10-31', '2026-11-02'), 2);
});

test('avatar placeholders use Latin initials for English names and Chinese surnames', () => {
  assert.deepEqual(['徐琳', '陳明', '周宁', '单婷', 'Élodie', 'Alex', '当前对话 AI', ''].map(avatarInitial),
    ['X', 'C', 'Z', 'S', 'E', 'A', 'D', '?']);
});

test('the timeline clips intervals at the viewport and displays single dates', () => {
  const range = dateRange('timeline', '2026-11-01');
  assert.equal(range.to, '2026-11-28');
  assert.deepEqual(timelinePosition({ startOn: '2026-10-25', dueOn: '2026-12-03' }, range), { left: '0%', width: '100%' });
  assert.deepEqual(span({ startOn: null, dueOn: '2026-11-28' }), { from: '2026-11-28', to: '2026-11-28' });
  assert.equal(timelinePosition({ startOn: null, dueOn: '2026-10-31' }, range), null);
  assert.equal(timelinePosition({ startOn: null, dueOn: null }, range), null);
});

test('choosing a human or AI lead retains the previous lead as a participant', () => {
  const agent = { id:'current', name:'AI', ownerId:null };
  const initial = { ...taskDefaults(), assigneeId:'alice', participantIds:['sam'], participantAgents:[agent] };
  const aiLead = updateCollaborator(initial,agent,'lead');
  assert.equal(aiLead.assigneeId,null);
  assert.deepEqual(aiLead.assigneeAgent,agent);
  assert.deepEqual(aiLead.participantIds,['alice','sam']);
  assert.deepEqual(aiLead.participantAgents,[]);
  const humanLead = updateCollaborator(aiLead,'sam','lead');
  assert.equal(humanLead.assigneeId,'sam');
  assert.deepEqual(humanLead.participantIds,['alice']);
  assert.deepEqual(humanLead.participantAgents,[agent]);
  assert.equal(taskCollaborators(humanLead).lead,collaboratorKey('sam'));
  const demoted = updateCollaborator(humanLead,'sam','lead');
  assert.equal(taskCollaborators(demoted).lead,null);
  assert(demoted.participantIds.includes('sam'));
  const removed = updateCollaborator(humanLead,'sam','toggle');
  assert(!taskCollaborators(removed).members.has(collaboratorKey('sam')));
  assert.equal(removed.assigneeId,null);
  assert.deepEqual(removed.participantAgents,[agent]);
});

test('cards derive only from live project conversations and preserve local progress', () => {
  const base = { displayTitle: 'Conversation', blank: false, running: false, updatedAt: 0 };
  const project = { workspaceId: 'a', title: 'A', sessionIds: ['idle', 'running', 'blank', 'child', 'archived'] };
  const summaries = {
    idle: { ...base, id: 'idle' },
    running: { ...base, id: 'running', running: true, updatedAt: 100 },
    blank: { ...base, id: 'blank', blank: true },
    child: { ...base, id: 'child', parentId: 'idle' },
    archived: { ...base, id: 'archived' },
    unrelated: { ...base, id: 'unrelated' },
  };
  const cards = projectCards(project, summaries, ['archived'], {
    idle: { status: 'review', startOn: null, dueOn: '2026-11-20', revision: 2 },
  });
  assert.deepEqual(cards.map(({ id, status }) => [id, status]), [['running', 'doing'], ['idle', 'review']]);
  assert.equal(cards[1]?.dueOn, '2026-11-20');
});

test('assignee names come from the current roster for the same project scope', () => {
  const card = { assignee: { scope: 'project-a', userId: 'member' } };
  const roster = { scope: 'project-a', canAssign: true, members: [{ userId: 'member', name: 'Member' }] };
  assert.equal(assigneeName(card, roster), 'Member');
  assert.equal(assigneeName(card, { ...roster, members: [] }), undefined);
  assert.equal(assigneeName(card, { ...roster, scope: 'project-b' }), undefined);
  assert.equal(assigneeName(card, null), undefined);
});
