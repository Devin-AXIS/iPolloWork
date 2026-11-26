import { useState } from "react";
import { IconCheckOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import { SearchInput } from "../../../_shared/ui/controls.tsx";
import type { EnterpriseDetail } from "../shared/enterprise.ts";
import { format, type EnterpriseLabels } from "./enterprise-locale.ts";
import { DirectoryStatus, useMemberDirectory, type Call } from "./enterprise-ui.tsx";
import { Monogram } from "./glyphs.tsx";
import css from "./suite.module.css";

export function EmployeeRecipients({
  enterpriseId, detail, t, call, revision, selected, change, disabled, managersHaveAccess = false, excludeUserId,
}: {
  enterpriseId: string; detail: Pick<EnterpriseDetail, "departments">; t: EnterpriseLabels; call: Call; revision: number;
  selected: string[]; change(next: string[]): void; disabled: boolean; managersHaveAccess?: boolean;
  excludeUserId?: string | undefined;
}) {
  const [query, setQuery] = useState("");
  const directory = useMemberDirectory(enterpriseId, call, revision, { query, active: true });
  const people = directory.data?.items.filter(member => member.userId !== excludeUserId &&
    (!managersHaveAccess || member.role === "member" || selected.includes(member.userId))) ?? [];
  return <section>
    <h3>{t.employeeRecipients} · {format(t.peopleCount, { count: selected.length })}</h3>
    <SearchInput className={css.recipientSearch!} placeholder={t.searchEmployeeRecipients} aria-label={t.searchEmployeeRecipients}
      maxLength={120} value={query} disabled={disabled} onChange={event => setQuery(event.target.value)}/>
    <div className={css.pickList}>
      {people.map(person => {
        const checked = selected.includes(person.userId);
        const department = detail.departments.find(item => item.id === person.departmentId);
        return <button key={person.userId} type="button" className={css.pickRow} aria-pressed={checked}
          disabled={disabled || (!checked && selected.length >= 500)}
          onClick={() => change(checked ? selected.filter(id => id !== person.userId) : [...selected, person.userId])}>
          <Monogram id={person.userId} label={person.name} size={24} round/>
          <span><strong>{person.name}</strong><small>{[person.employeeNumber, department?.name].filter(Boolean).join(" · ")}</small></span>
          <i className={css.pickCheck}>{checked && <IconCheckOutlineRegular size={12} aria-hidden="true"/>}</i>
        </button>;
      })}
    </div>
    {directory.data && !people.length && <p className={css.quietLine}>{t.noMembersMatch}</p>}
    <DirectoryStatus directory={directory} t={t}/>
    {!!selected.length && <button type="button" className={css.inlineLink} disabled={disabled} onClick={() => change([])}>
      {t.clearSelection}
    </button>}
  </section>;
}
