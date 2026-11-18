import { ServiceError } from "./errors.js";

export class InvitationRosterError extends ServiceError {
  constructor(code: string, status: 400 | 409 | 413, message: string, readonly row?: number) {
    super(code, status, row === undefined ? message : `CSV 第 ${row} 行：${message}`);
  }
}

/** Read the Work roster, retaining the physical row number for validation errors. */
export function organizationInvitationRoster(csv: string, codeOnly = false) {
  const records: { fields: string[]; line: number }[] = [];
  const input = csv.replace(/^\uFEFF/, "");
  let row: string[] = [];
  let line = 1, rowStart = 1;
  const cell = /(?:"((?:[^"]|"")*)"|([^",\r\n]*))(?=,|\r|\n|$)/y;
  for (let offset = 0; offset <= input.length;) {
    cell.lastIndex = offset;
    const match = cell.exec(input);
    if (!match) throw new InvitationRosterError("INVITATION_CSV_INVALID", 400, "CSV 引号格式有误", line);
    row.push((match[1]?.replaceAll('""', '"') ?? match[2] ?? "").trim());
    line += match[0].match(/\r\n|\r|\n/g)?.length ?? 0;
    offset = cell.lastIndex;
    if (input[offset] === ",") { offset++; continue; }
    if (row.some(Boolean)) {
      records.push({ fields: row, line: rowStart });
      if (records.length > 501)
        throw new InvitationRosterError("INVITATION_CSV_TOO_MANY_ROWS", 400, "每次最多导入 500 位成员，请拆分文件后重试");
    }
    row = [];
    rowStart = ++line;
    offset += input.startsWith("\r\n",offset) ? 2 : 1;
  }
  if (!records.length) throw new InvitationRosterError("INVITATION_CSV_EMPTY", 400, "CSV 中没有成员记录");
  const aliases = new Map([["name","名称"], ["employee number","工号"], ["department","部门名称"]]);
  const headers = records[0]!.fields.map(header => codeOnly ? aliases.get(header.toLowerCase()) ?? header : header);
  const required = codeOnly ? ["名称","工号"] : ["名称","工号","部门名称","角色"];
  if (!required.every(key => headers.includes(key)) || new Set(headers).size !== headers.length)
    throw new InvitationRosterError("INVITATION_CSV_INVALID", 400, `CSV 表头需要${required.join("、")}，列名不能重复，请使用下载的 CSV 模板`);
  if (records.length === 1) throw new InvitationRosterError("INVITATION_CSV_EMPTY", 400, "CSV 只有表头，请至少填写一位成员");
  return records.slice(1).map(({ fields: record, line }) => {
    const get = (key:string) => record[headers.indexOf(key)] ?? "";
    const role = codeOnly ? "member" : { "成员":"member", "普通成员":"member", "管理员":"admin" }[get("角色")];
    if (record.length !== headers.length)
      throw new InvitationRosterError("INVITATION_CSV_INVALID", 400, "列数与表头不一致，请检查分隔逗号", line);
    if (!get("名称") || !get("工号"))
      throw new InvitationRosterError("INVITATION_CSV_INVALID", 400, "名称和工号为必填项", line);
    if (!role) throw new InvitationRosterError("INVITATION_CSV_INVALID", 400, "角色无效", line);
    return { line, person: { name:get("名称"), employeeNumber:get("工号"), departmentName:get("部门名称") || null, role, email:codeOnly ? null : get("邮箱") || null } };
  });
}
