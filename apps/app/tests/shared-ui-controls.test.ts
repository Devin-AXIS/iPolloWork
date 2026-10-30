import { expect, test } from "bun:test";
import { createElement } from "react";
import * as core from "@ipollowork/ui/core";
import { renderToStaticMarkup } from "react-dom/server";
import { WorkItemList } from "../src/react-app/domains/work/work-item-list";
import { EnvironmentVariableTableItem } from "../src/react-app/domains/settings/pages/environment-variable-table";
import { DEFAULT_WORK_BOARD_CONFIG } from "@ipollowork/types/work-items";
import { SearchField, NumberField, Slider, Calendar, DatePicker, TimeInput, FileUpload, FileUploadItem, parseCalendarDate, formatCalendarDate, validateFileSelection } from "@ipollowork/ui/core";

test("all high-frequency controls expose shared public constructors", () => {
  for (const control of [SearchField, NumberField, Slider, Calendar, DatePicker, TimeInput, FileUpload, FileUploadItem]) expect(typeof control).toBe("function");
});

test("search keeps a named clear action and disabled input", () => {
  const html = renderToStaticMarkup(createElement(SearchField, { value: "中文", onValueChange() {}, clearLabel: "清除搜索", "aria-label": "搜索素材", disabled: true }));
  expect(html).toContain('aria-label="清除搜索"');
  expect(html).toContain('aria-label="搜索素材"');
  expect(html).toContain('disabled');
  expect(html).toContain('data-slot="search-field"');
  expect(html).toContain("text-ui-control");
  expect(html).toContain("text-foreground");
});

test("numeric out-of-range input stays visible with linked feedback", () => {
  const html = renderToStaticMarkup(createElement(NumberField, { label: "宽度", value: 1000, min: 1, max: 999, invalidLabel: "请输入 1–999" }));
  expect(html).toContain('aria-invalid="true"');
  expect(html).toContain('aria-describedby=');
  expect(html).toContain('请输入 1–999');
  expect(html).toContain('1000');
});

test("date-only values round trip locally and reject impossible calendar dates", () => {
  for (const value of ["2024-02-29", "2026-10-12", "0001-01-01"]) {
    const date = parseCalendarDate(value);
    expect(date).toBeInstanceOf(Date);
    if (!date) throw new Error("Date parsing failed");
    expect(formatCalendarDate(date)).toBe(value);
  }
  for (const value of ["2026-02-29", "2026-13-01", "2026-04-31", "2026-1-1", "garbage"]) expect(parseCalendarDate(value)).toBeUndefined();
});

const messages = { invalidType: "类型不支持", tooLarge: "文件过大", empty: "空文件", tooMany: "仅一个文件" };
test("file validation treats a batch atomically and checks type size and empty files", () => {
  const image = new File(["image"], "图片.PNG", { type: "image/png" });
  expect(validateFileSelection([image], { accept: ".png" }, messages)).toBeNull();
  expect(validateFileSelection([image], { accept: "image/*" }, messages)).toBeNull();
  expect(validateFileSelection([image], { accept: "audio/*" }, messages)).toBe("类型不支持");
  expect(validateFileSelection([image], { maxSize: 2 }, messages)).toBe("文件过大");
  expect(validateFileSelection([new File([], "empty.png")], {}, messages)).toBe("空文件");
  expect(validateFileSelection([image, image], {}, messages)).toBe("仅一个文件");
});

test("upload item never invents progress or cancellation capability", () => {
  const html = renderToStaticMarkup(createElement(FileUploadItem, { name: "图片.png", status: "uploading", statusLabel: "正在上传" }));
  expect(html).not.toContain('role="progressbar"');
  expect(html).not.toContain('<button');
  const failed = renderToStaticMarkup(createElement(FileUploadItem, { name: "图片.png", status: "error", statusLabel: "上传失败", error: "连接中断", retryLabel: "重试", onRetry() {} }));
  expect(failed).toContain('role="alert"');
  expect(failed).toContain('重试');
  expect(failed).toContain('图片.png');
});

test("composed fields preserve orientation, labels, descriptions and linked errors", () => {
  const html = renderToStaticMarkup(createElement(core.Field, { orientation: "responsive", "data-invalid": true },
    createElement(core.FieldContent, null,
      createElement(core.FieldLabel, { htmlFor: "composed-input" }, "名称"),
      createElement(core.FieldDescription, { id: "composed-help" }, "说明")),
    createElement(core.Input, { id: "composed-input", required: true, "aria-invalid": true, "aria-describedby": "composed-help composed-error" }),
    createElement(core.FieldError, { id: "composed-error" }, "失败保留输入")));
  expect(html).toContain('data-orientation="responsive"');
  expect(html).toContain('for="composed-input"');
  expect(html).toContain('aria-describedby="composed-help composed-error"');
  expect(html).toContain('role="alert"');
  expect(html).toContain("min-w-0");
});

test("multiline input groups keep counts outside the editable textarea", () => {
  const html = renderToStaticMarkup(createElement(core.InputGroup, null,
    createElement(core.InputGroupTextarea, { id: "composed-text", rows: 3, defaultValue: "第一行\n第二行", "aria-describedby": "composed-count" }),
    createElement(core.InputGroupAddon, { align: "block-end", tabIndex: -1 },
      createElement(core.InputGroupText, { id: "composed-count" }, "9 / 300"))));
  expect(html).toContain('data-align="block-end"');
  expect(html).toContain('rows="3"');
  expect(html).toContain('aria-describedby="composed-count"');
  expect(html).toContain('tabindex="-1"');
});

test("table sorting announces current order and retains a compact named button", () => {
  for (const direction of ["none", "ascending", "descending"] satisfies core.TableSortDirection[]) {
    const html = renderToStaticMarkup(createElement(core.TableSortHead, {direction, label:"名称排序", onDirectionChange() {}, children:"名称"}));
    expect(html).toContain('aria-sort="' + direction + '"');
    expect(html).toContain('aria-label="名称排序"');
    expect(html).toContain("h-8");
  }
});

test("page selection is local to the selectable page and announces mixed state", () => {
  const mixed = renderToStaticMarkup(createElement(core.TablePageSelection, {selectableCount:5,selectedCount:2,label:"选择当前页",onCheckedChange() {}}));
  expect(mixed).toContain('aria-checked="mixed"');
  expect(mixed).toContain("lucide-minus");
  const empty = renderToStaticMarkup(createElement(core.TablePageSelection, {selectableCount:0,selectedCount:0,label:"选择当前页",onCheckedChange() {}}));
  expect(empty).toContain("disabled");
});

test("pagination disables boundaries and reports a real empty total", () => {
  const html = renderToStaticMarkup(createElement(core.TablePagination, {
    pageIndex:0,pageSize:10,total:0,onPageChange(){},onPageSizeChange(){},
    labels:{navigation:"分页",previous:"前页",next:"后页",pageSize:"条数",status:(page,pages,total)=>page+"/"+pages+" 共"+total}
  }));
  expect(html).toContain("0/0 共0");
  expect(html).toContain('aria-label="前页"');
  expect(html).toContain('aria-label="后页"');
  expect(html.match(/ disabled=""/g)?.length).toBeGreaterThanOrEqual(2);
});

test("bulk actions do not appear without selection and disable clearing while busy", () => {
  expect(renderToStaticMarkup(createElement(core.TableBulkActions,{selectedCount:0,label:"已选0",clearLabel:"清空",onClear(){}}))).toBe("");
  const html = renderToStaticMarkup(createElement(core.TableBulkActions,{selectedCount:2,label:"跨页已选2",clearLabel:"清空",busy:true,onClear(){}}));
  expect(html).toContain('aria-busy="true"');
  expect(html).toContain(' disabled=""');
});

test("real work list pages ten loaded records and excludes automated records from selection", () => {
  const items = Array.from({ length: 23 }, (_, index) => ({
    key: String(index), projectName: "Proof",
    item: {
      id: String(index), workspaceId: "proof", title: "Task " + index, description: null,
      status: "planned", assignee: null, priority: "normal", startAt: null, dueAt: null,
      automation: index === 0 ? { enabled: true, recurrence: "once" } : null,
      automationLastRunAt: null, automationLastSessionId: null, automationLastError: null,
      position: index, customFields: {}, execution: null, lastError: null,
      runStartedAt: null, runCompletedAt: null, version: 1, createdAt: 1, updatedAt: 1,
    },
  })) satisfies Parameters<typeof WorkItemList>[0]["items"];
  const html = renderToStaticMarkup(createElement(WorkItemList, { items, board: DEFAULT_WORK_BOARD_CONFIG,
    refreshing: false, readError: false, onRefresh() {}, onOpen() {}, async onStatus() { return []; } }));
  expect(html.match(/data-row-id=/g)).toHaveLength(10);
  expect(html).toContain('aria-disabled="true"');
  expect(html).toContain('data-slot="table-pagination"');
  expect(html).not.toContain('data-row-id="10"');
});

test("real environment row never renders a cached secret until explicitly revealed", () => {
  const html = renderToStaticMarkup(createElement(EnvironmentVariableTableItem, {
    item: { key: "PROOF", value: "never-display-this-secret", hasValue: true, updatedAt: 1 },
    isRevealed: false, canEdit: true, deleting: false, revealing: false,
    selection: createElement(core.Checkbox, { "aria-label": "Select PROOF" }),
    onEdit() {}, onToggleReveal() {}, onDelete() {},
  }));
  expect(html).not.toContain("never-display-this-secret");
  expect(html).toContain("••••••••");
  expect(html).toContain('data-row-id="PROOF"');
  expect(html).toContain('aria-label="Select PROOF"');
});
