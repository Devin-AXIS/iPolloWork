import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Building2, ChevronDown, ChevronRight, Loader2, Search, UserRound, X } from "lucide-react";
import type { EnterpriseDepartment, EnterpriseMember } from "@ipollowork/types/enterprise";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { enterpriseApi, enterpriseErrorMessage, enterpriseIdentity } from "@/app/lib/enterprise-client";
import type { EnterpriseConnection } from "@/app/lib/enterprise-connections";

export type EnterprisePeopleSelection = { memberIds: string[]; departmentIds: string[] };
type MemberPage = { items: EnterpriseMember[]; nextCursor: string | null };
const EMPTY: EnterprisePeopleSelection = { memberIds: [], departmentIds: [] };

export function EnterprisePeoplePicker({ connection, value, onChange, allowDepartments = false, disabled = false }: {
  connection: EnterpriseConnection; value: EnterprisePeopleSelection;
  onChange: (value: EnterprisePeopleSelection) => void; allowDepartments?: boolean; disabled?: boolean;
}) {
  const identity = enterpriseIdentity(connection);
  const [departments, setDepartments] = useState<EnterpriseDepartment[]>([]);
  const [departmentCursor, setDepartmentCursor] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [pages, setPages] = useState<Record<string, MemberPage>>({});
  const [search, setSearch] = useState("");
  const searchRef = useRef(search); searchRef.current = search;
  const [searchPage, setSearchPage] = useState<MemberPage | null>(null);
  const [loading, setLoading] = useState<string | null>("departments");
  const [error, setError] = useState<string | null>(null);
  const generation = useRef(0);
  const controller = useRef<AbortController | null>(null);
  const connectionRef = useRef(connection);
  connectionRef.current = connection;
  const selectionRef = useRef(value);
  selectionRef.current = value;
  const childrenById = useMemo(() => {
    const groups = new Map<string | null, EnterpriseDepartment[]>();
    for (const department of departments) groups.set(department.parentId, [...(groups.get(department.parentId) ?? []), department]);
    return groups;
  }, [departments]);
  const descendantIds = (id: string) => {
    const result = new Set<string>();
    const pending = [{ id, depth: 0 }];
    while (pending.length) {
      const item = pending.pop();
      if (!item || result.has(item.id) || item.depth > 24) continue;
      result.add(item.id);
      pending.push(...(childrenById.get(item.id) ?? []).map((child) => ({ id: child.id, depth: item.depth + 1 })));
    }
    return result;
  };

  useEffect(() => {
    const request = new AbortController();
    controller.current = request;
    generation.current += 1;
    setDepartments([]); setPages({}); setExpanded(new Set()); setSearch(""); setSearchPage(null); setError(null); setLoading("departments");
    void enterpriseApi.departments(connectionRef.current, null, request.signal).then((page) => {
      setDepartments(page.items); setDepartmentCursor(page.nextCursor);
    }).catch((cause: unknown) => { if (!request.signal.aborted) setError(enterpriseErrorMessage(cause)); })
      .finally(() => { if (!request.signal.aborted) setLoading(null); });
    return () => { request.abort(); generation.current += 1; };
  }, [identity]);

  useEffect(() => {
    if (!search.trim()) { setSearchPage(null); return; }
    const request = new AbortController();
    const timer = window.setTimeout(() => {
      setLoading("search"); setError(null);
      void enterpriseApi.members(connectionRef.current, { search }, request.signal).then(setSearchPage)
        .catch((cause: unknown) => { if (!request.signal.aborted) setError(enterpriseErrorMessage(cause)); })
        .finally(() => { if (!request.signal.aborted) setLoading(null); });
    }, 250);
    return () => { window.clearTimeout(timer); request.abort(); };
  }, [identity, search]);

  const run = async (key: string, action: () => Promise<void>) => {
    const epoch = generation.current;
    setLoading(key); setError(null);
    try { await action(); } catch (cause) { if (epoch === generation.current) setError(enterpriseErrorMessage(cause)); }
    finally { if (epoch === generation.current) setLoading(null); }
  };
  const loadMembers = (departmentId: string, more = false) => run(departmentId, async () => {
    const epoch = generation.current;
    const page = await enterpriseApi.members(connectionRef.current, { departmentId, cursor: more ? pages[departmentId]?.nextCursor : null }, controller.current?.signal);
    if (epoch !== generation.current) return;
    setPages((current) => ({ ...current, [departmentId]: { ...page, items: more ? [...(current[departmentId]?.items ?? []), ...page.items] : page.items } }));
  });
  const toggleMember = (id: string) => {
    const selected = selectionRef.current;
    if (!selected.memberIds.includes(id) && selected.memberIds.length >= 500) { setError("单次最多选择 500 人，请缩小选择范围。"); return; }
    onChange({ ...selected, memberIds: selected.memberIds.includes(id) ? selected.memberIds.filter((item) => item !== id) : [...selected.memberIds, id] });
  };
  const selectDepartment = (departmentId: string) => {
    if (allowDepartments) {
      if (!value.departmentIds.includes(departmentId) && value.departmentIds.length >= 100) { setError("单次最多授权 100 个部门，请缩小选择范围。"); return; }
      onChange({ ...value, departmentIds: value.departmentIds.includes(departmentId) ? value.departmentIds.filter((id) => id !== departmentId) : [...value.departmentIds, departmentId] });
      return;
    }
    void run(departmentId, async () => {
      const epoch = generation.current;
      const members: EnterpriseMember[] = [];
      const cursors = new Set<string>();
      let cursor: string | null = null;
      do {
        const page = await enterpriseApi.members(connectionRef.current, { departmentId, includeDescendants: true, cursor }, controller.current?.signal);
        members.push(...page.items.filter((member) => member.status === "active"));
        cursor = page.nextCursor;
        if (members.length > 500 || cursors.size >= 20 || (cursor && cursors.has(cursor))) throw new Error("enterprise_selection_limit");
        if (cursor) cursors.add(cursor);
      } while (cursor);
      if (epoch !== generation.current) return;
      setPages((current) => {
        const next = { ...current };
        for (const id of descendantIds(departmentId)) next[id] = { items: members.filter((member) => member.departmentId === id), nextCursor: null };
        return next;
      });
      const selected = selectionRef.current;
      const ids = members.map((member) => member.id);
      const allSelected = ids.length > 0 && ids.every((id) => selected.memberIds.includes(id));
      if (!allSelected && new Set([...selected.memberIds, ...ids]).size > 500) throw new Error("enterprise_selection_limit");
      onChange({ ...selected, memberIds: allSelected ? selected.memberIds.filter((id) => !ids.includes(id)) : [...new Set([...selected.memberIds, ...ids])] });
    });
  };
  const allMembers = [...Object.values(pages).flatMap((page) => page.items), ...(searchPage?.items ?? [])];
  const labelForMember = (id: string, index: number) => {
    const member = allMembers.find((item) => item.id === id);
    return member?.displayName || member?.email || `已选员工 ${index + 1}`;
  };
  const memberRow = (member: EnterpriseMember) => <label key={member.id} className="flex min-h-10 cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 hover:bg-muted">
    <Checkbox checked={value.memberIds.includes(member.id)} disabled={disabled || member.status !== "active" || Boolean(loading)} onCheckedChange={() => toggleMember(member.id)} aria-label={`选择 ${member.displayName || member.email}`} />
    <UserRound className="size-4 shrink-0 text-muted-foreground" />
    <span className="min-w-0"><span className="block truncate text-sm">{member.displayName || member.email}</span><span className="block truncate text-xs text-muted-foreground">{member.email}{member.departmentId ? ` · ${departments.find((item) => item.id === member.departmentId)?.name ?? "企业部门"}` : ""}</span></span>
  </label>;
  const departmentNode = (department: EnterpriseDepartment, visited: Set<string>, depth = 0): ReactNode => {
    if (visited.has(department.id) || depth > 24) return null;
    const seen = new Set(visited).add(department.id);
    const page = pages[department.id];
    const children = childrenById.get(department.id) ?? [];
    const hasChildren = children.length > 0 || Boolean(page?.items.length || page?.nextCursor);
    const canExpand = hasChildren || !page;
    const subtree = descendantIds(department.id);
    const visibleIds = [...new Set(allMembers.filter((member) => member.departmentId && subtree.has(member.departmentId)).map((member) => member.id))];
    const selectedCount = visibleIds.filter((id) => value.memberIds.includes(id)).length;
    const isExpanded = expanded.has(department.id) && hasChildren;
    const checked = allowDepartments ? value.departmentIds.includes(department.id) : Boolean(visibleIds.length && [...subtree].every((id) => pages[id] && !pages[id].nextCursor) && selectedCount === visibleIds.length);
    return <div key={department.id}>
      <div className="flex min-h-10 items-center gap-2 rounded-lg px-2 hover:bg-muted">
        {canExpand ? <Button variant="ghost" size="icon-sm" disabled={Boolean(loading)} aria-label={`${isExpanded ? "收起" : "展开"}${department.name}`} aria-expanded={isExpanded} onClick={() => { setExpanded((current) => { const next = new Set(current); if (isExpanded) next.delete(department.id); else next.add(department.id); return next; }); if (!isExpanded && !page) void loadMembers(department.id); }}>
          {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
        </Button> : <span className="size-7 shrink-0" aria-hidden="true" />}
        <Checkbox checked={checked} indeterminate={!allowDepartments && selectedCount > 0 && !checked} disabled={disabled || Boolean(loading)} aria-label={`选择部门 ${department.name}`} onCheckedChange={() => selectDepartment(department.id)} />
        <Building2 className="size-4 shrink-0 text-muted-foreground" /><span className="min-w-0 truncate text-sm">{department.name}</span>
      </div>
      {isExpanded ? <div className="ml-5 border-l border-border pl-2">
        {children.map((item) => departmentNode(item, seen, depth + 1))}
        {page?.items.map(memberRow)}
        {page?.nextCursor ? <Button variant="ghost" size="sm" disabled={Boolean(loading)} onClick={() => void loadMembers(department.id, true)}>加载更多人员</Button> : null}
      </div> : null}
    </div>;
  };
  return <div data-testid="enterprise-people-picker" className="space-y-3">
    <label className="block space-y-1.5"><span className="text-xs font-medium">搜索企业人员</span><div className="relative"><Search className="pointer-events-none absolute left-3 top-2.5 size-4 text-muted-foreground" /><Input className="pl-9" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="姓名、邮箱或部门" disabled={disabled} /></div></label>
    {error ? <p role="alert" className="rounded-lg bg-feedback-error p-3 text-sm text-red-11">{error}</p> : null}
    <div className="grid min-h-64 grid-cols-[minmax(0,1fr)_minmax(150px,.65fr)] divide-x rounded-xl border border-border max-[560px]:grid-cols-1 max-[560px]:divide-x-0 max-[560px]:divide-y">
      <div className="max-h-80 overflow-y-auto p-2" aria-label="部门与人员">
        {loading ? <p role="status" className="flex items-center gap-2 px-2 py-3 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />正在加载通讯录</p> : null}
        {search.trim() ? searchPage?.items.map(memberRow) : <>
          {departments.filter((item) => !item.parentId || !departments.some((parent) => parent.id === item.parentId)).map((item) => departmentNode(item, new Set()))}
          <Button variant="ghost" size="sm" onClick={() => { setExpanded((current) => new Set(current).add("unassigned")); void loadMembers("unassigned"); }}>未分配部门</Button>
          {expanded.has("unassigned") ? pages.unassigned?.items.map(memberRow) : null}
          {expanded.has("unassigned") && pages.unassigned?.nextCursor ? <Button variant="ghost" size="sm" disabled={Boolean(loading)} onClick={() => void loadMembers("unassigned", true)}>加载更多未分配人员</Button> : null}
          {departmentCursor ? <Button variant="ghost" size="sm" disabled={Boolean(loading)} onClick={() => void run("departments", async () => { const epoch = generation.current; const page = await enterpriseApi.departments(connectionRef.current, departmentCursor, controller.current?.signal); if (epoch === generation.current) { setDepartments((current) => [...current, ...page.items]); setDepartmentCursor(page.nextCursor); } })}>加载更多部门</Button> : null}
        </>}
        {search.trim() && searchPage?.nextCursor ? <Button variant="ghost" size="sm" disabled={Boolean(loading)} onClick={() => void run("search", async () => { const requestSearch = search; const page = await enterpriseApi.members(connectionRef.current, { search, cursor: searchPage.nextCursor }, controller.current?.signal); if (requestSearch === searchRef.current) setSearchPage((current) => ({ ...page, items: [...(current?.items ?? []), ...page.items] })); })}>加载更多搜索结果</Button> : null}
        {searchPage && !searchPage.items.length && !loading ? <p className="p-3 text-sm text-muted-foreground">没有匹配的人员</p> : null}
      </div>
      <div className="max-h-80 overflow-y-auto p-3"><div className="mb-3 flex items-center justify-between gap-2"><p className="text-xs font-medium">已选 {value.memberIds.length} 人{allowDepartments ? ` · ${value.departmentIds.length} 个部门` : ""}</p><Button variant="ghost" size="sm" disabled={disabled} onClick={() => onChange(EMPTY)}>清空</Button></div>
        {value.memberIds.map((id, index) => <div key={id} className="flex items-center gap-2 py-1"><span className="min-w-0 flex-1 truncate text-sm">{labelForMember(id, index)}</span><Button variant="ghost" size="icon-sm" disabled={disabled} aria-label={`取消 ${labelForMember(id, index)}`} onClick={() => toggleMember(id)}><X className="size-3.5" /></Button></div>)}
        {value.departmentIds.map((id) => <div key={id} className="flex items-center gap-2 py-1"><Building2 className="size-3.5 shrink-0" /><span className="min-w-0 flex-1 truncate text-sm">{departments.find((item) => item.id === id)?.name ?? "已选部门"}</span><Button variant="ghost" size="icon-sm" disabled={disabled} aria-label="取消部门" onClick={() => selectDepartment(id)}><X className="size-3.5" /></Button></div>)}
      </div>
    </div>
  </div>;
}
