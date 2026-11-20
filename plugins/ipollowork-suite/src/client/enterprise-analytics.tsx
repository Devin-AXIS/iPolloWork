/** Enterprise usage view; a query change never displays the previous query's result. */
import { useEffect, useState } from "react";
import { Button } from "@deepseek-ai/dsh-client-ui-primitives";
import type { EnterpriseAnalytics } from "../shared/enterprise-analytics.ts";
import { format, type EnterpriseLabels } from "./enterprise-locale.ts";
import { EmptyState, ListSkeleton, Notice, type Call } from "./enterprise-ui.tsx";
import css from "./suite.module.css";

/** Show bounded server aggregates, keeping uncollected metrics distinct from zero. */
export function AnalyticsTab({ enterpriseId, canManage, call, revision, t, language }: {
  enterpriseId: string; canManage: boolean; call: Call; revision: number; t: EnterpriseLabels; language: string;
}) {
  const [days, setDays] = useState(30);
  const [groupBy, setGroupBy] = useState<EnterpriseAnalytics["groupBy"]>("department");
  const [page, setPage] = useState(1);
  const [activityPage, setActivityPage] = useState(1);
  const [retry, setRetry] = useState(0);
  const queryKey = JSON.stringify([enterpriseId, days, groupBy, page, activityPage, revision, retry]);
  const [result, setResult] = useState<{ key: string; data?: EnterpriseAnalytics; error?: string }>();
  useEffect(() => {
    if (!canManage) return;
    let active = true;
    void call<EnterpriseAnalytics>("/organizations/" + enterpriseId + "/analytics", { days, groupBy, page, activityPage })
      .then(data => { if (active) setResult({ key: queryKey, data }); },
        (error: unknown) => { if (active) setResult({ key: queryKey, error: error instanceof Error ? error.message : "IPW_ACCOUNT_UNAVAILABLE" }); });
    return () => { active = false; };
  }, [canManage, call, queryKey, enterpriseId, days, groupBy, page, activityPage]);
  if (!canManage) return <EmptyState title={t.analyticsManager} />;
  const current = result?.key === queryKey ? result : undefined;
  const data = current?.data;
  const number = (value: number) => new Intl.NumberFormat(language).format(value);
  const groups = { department: t.analyticsDepartment, member: t.analyticsMember, sku: t.analyticsSku };
  const pages = data ? Math.max(1, Math.ceil(data.totalRows / data.pageSize)) : 1;
  const metrics = data ? [
    [t.analyticsTasks, number(data.totals.tasks)],
    [t.analyticsTokens, data.totals.measured ? number(data.totals.inputTokens + data.totals.outputTokens) : t.analyticsUnavailable],
    [t.analyticsProjects, number(data.projects)],
    [t.analyticsSkills, number(data.skills)],
    [t.analyticsPlugins, number(data.plugins)],
    [t.analyticsSkillCalls, number(data.skillInvocations)],
    [t.analyticsPluginCalls, number(data.pluginInvocations)],
  ] : [];
  return <div className={css.analytics} data-ipw-analytics>
    <div className={css.analyticsFilters}>
      <label>{t.analyticsDays}<select value={days} onChange={event => { setDays(Number(event.target.value)); setPage(1); setActivityPage(1); }}>
        {[7, 30, 90].map(value => <option key={value} value={value}>{format(t.analyticsPeriod, { days: value })}</option>)}
      </select></label>
      <label>{t.analyticsGroup}<select value={groupBy} onChange={event => { setGroupBy(event.target.value as EnterpriseAnalytics["groupBy"]); setPage(1); setActivityPage(1); }}>
        {Object.entries(groups).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
      </select></label>
    </div>
    <p className={css.analyticsHint}>{t.analyticsHint} {t.analyticsInvocationHint}</p>
    {current?.error ? <Notice error={current.error} t={t} fallback={t.analyticsLoadFailed} retry={() => setRetry(value => value + 1)} /> : !data ? <ListSkeleton /> : <>
      <dl className={css.analyticsMetrics}>{metrics.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      <p className={css.analyticsHint}>{format(t.analyticsCoverage, { measured: number(data.totals.measured), tasks: number(data.totals.tasks) })}</p>
      {!data.rows.length ? <EmptyState title={t.analyticsEmpty} /> : <div className={css.analyticsTableScroll} tabIndex={0} role="region" aria-label={t.analyticsTab}>
        <table className={css.analyticsTable}><thead><tr>{[groups[groupBy], t.analyticsTasks, t.analyticsSuccess, t.analyticsFailed, t.analyticsInput, t.analyticsOutput, t.analyticsPoints].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{data.rows.map(row => <tr key={row.id}><th scope="row">{row.name || t.analyticsUnnamed}</th><td>{number(row.tasks)}</td><td>{number(row.succeeded)}</td><td>{number(row.failed)}</td><td>{row.measured ? number(row.inputTokens) : t.analyticsUnavailable}</td><td>{row.measured ? number(row.outputTokens) : t.analyticsUnavailable}</td><td>{number(row.points)}</td></tr>)}</tbody>
        </table>
      </div>}
      {pages > 1 && <div className={css.analyticsPages}><Button variant="ghost" size="sm" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>{t.analyticsPrevious}</Button><span>{format(t.analyticsPage, { page, pages })}</span><Button variant="ghost" size="sm" disabled={page >= pages} onClick={() => setPage(value => value + 1)}>{t.analyticsNext}</Button></div>}
      <h2>{t.analyticsActivity}</h2>
      {data.activityRows.length ? <div className={css.analyticsTableScroll} tabIndex={0} role="region" aria-label={t.analyticsActivity}>
        <table className={css.analyticsTable}><thead><tr>{[groupBy === "sku" ? t.analyticsName : groups[groupBy], t.analyticsKind, t.analyticsCalls, t.analyticsSuccess].map(label => <th key={label} scope="col">{label}</th>)}</tr></thead>
          <tbody>{data.activityRows.map(row => <tr key={row.kind + row.id}><th scope="row">{row.name || t.analyticsUnnamed}</th><td>{row.kind === "skill" ? t.analyticsSkillType : t.analyticsToolType}</td><td>{number(row.calls)}</td><td>{number(row.succeeded)}</td></tr>)}</tbody>
        </table>
      </div> : <p className={css.analyticsHint}>{t.analyticsNoActivity}</p>}
      {data.activityTotalRows > data.pageSize && <div className={css.analyticsPages}><Button variant="ghost" size="sm" disabled={activityPage <= 1} onClick={() => setActivityPage(value => value - 1)}>{t.analyticsPrevious}</Button><span>{format(t.analyticsPage, { page: activityPage, pages: Math.ceil(data.activityTotalRows / data.pageSize) })}</span><Button variant="ghost" size="sm" disabled={activityPage >= Math.ceil(data.activityTotalRows / data.pageSize)} onClick={() => setActivityPage(value => value + 1)}>{t.analyticsNext}</Button></div>}
    </>}
  </div>;
}
