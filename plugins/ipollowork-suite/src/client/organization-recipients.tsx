import { useEffect, useId, useRef, useState } from "react";
import { IconCheckOutlineRegular } from "@deepseek-ai/dsh-client-ui-primitives";
import { FieldPopover, FormButton, SearchInput } from "../../../_shared/ui/controls.tsx";
import { ChevronDown, lineStroke } from "../../../_shared/ui/icons.ts";
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
  const people = directory.data?.items.filter(member => member.userId !== excludeUserId) ?? [];
  return <section>
    <h3>{t.employeeRecipients} · {format(t.peopleCount, { count: selected.length })}</h3>
    <SearchInput className={css.recipientSearch!} placeholder={t.searchEmployeeRecipients} aria-label={t.searchEmployeeRecipients}
      maxLength={120} value={query} disabled={disabled} onChange={event => setQuery(event.target.value)}/>
    <div className={css.pickList}>
      {people.map(person => {
        const checked = selected.includes(person.userId);
        const alreadyGranted = managersHaveAccess && person.role !== "member" && !checked;
        const department = detail.departments.find(item => item.id === person.departmentId);
        return <button key={person.userId} type="button" className={css.pickRow} aria-pressed={checked}
          disabled={disabled || alreadyGranted || (!checked && selected.length >= 500)}
          onClick={() => change(checked ? selected.filter(id => id !== person.userId) : [...selected, person.userId])}>
          <Monogram id={person.userId} label={person.name} size={24} round/>
          <span><strong>{person.name}</strong><small>{[person.employeeNumber, person.email, department?.name,
            alreadyGranted && t.managerAlreadyHasAccess].filter(Boolean).join(" · ")}</small></span>
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

export function DepartmentRecipients({ departments, selected, change, disabled, t }: {
  departments: EnterpriseDetail["departments"]; selected: string[]; change(next: string[]): void;
  disabled: boolean; t: EnterpriseLabels;
}) {
  const id = useId();
  const anchor = "--ipw-departments-" + id.replaceAll(":", "");
  const picker = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const shown = open && !disabled;
  useEffect(() => {
    if (!shown) return;
    const closeOutside = (event: PointerEvent) => {
      if (event.target instanceof Node && !picker.current?.contains(event.target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOutside);
    return () => document.removeEventListener("pointerdown", closeOutside);
  }, [shown]);
  if (!departments.length) return <p className={css.quietLine}>{t.noDepartments}</p>;
  const summary = selected.length ? format(t.departmentSelectionCount, { count: selected.length }) : t.chooseDepartments;
  return <div ref={picker} className="ipw-field-menu" onBlur={event => {
    if (event.relatedTarget instanceof Node && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
  }} onKeyDown={event => {
    if (!shown || event.key !== "Escape") return;
    event.preventDefault();
    event.stopPropagation();
    setOpen(false);
    trigger.current?.focus();
  }}>
    <FormButton ref={trigger} className="ipw-control ipw-select-trigger" style={{ anchorName: anchor }}
      type="button" aria-label={`${t.departmentRecipients} · ${summary}`} aria-expanded={shown}
      aria-controls={shown ? id : undefined} disabled={disabled} onClick={() => setOpen(value => !value)}>
      <span>{summary}</span><ChevronDown size={13} strokeWidth={lineStroke} aria-hidden="true"/>
    </FormButton>
    {shown && <FieldPopover anchor={anchor} width="anchor">
      <div id={id} role="group" aria-label={t.departmentRecipients} className={css.departmentOptions}>
        {departments.map(department => {
          const checked = selected.includes(department.id);
          return <label key={department.id}>
            <input type="checkbox" checked={checked} disabled={!checked && selected.length >= 200}
              onChange={() => change(checked ? selected.filter(id => id !== department.id) : [...selected, department.id])}/>
            <span>{department.name}</span>
          </label>;
        })}
      </div>
    </FieldPopover>}
  </div>;
}
