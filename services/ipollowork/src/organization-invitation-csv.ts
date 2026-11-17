import { ServiceError } from "./errors.js";

/** Read the existing four-column Work roster. Optional email binds a code to an account. */
export function organizationInvitationRoster(csv: string, codeOnly = false) {
  const records: string[][] = [];
  const input = csv.replace(/^\uFEFF/, "");
  let row: string[] = [];
  const cell = /(?:"((?:[^"]|"")*)"|([^",\r\n]*))(?=,|\r|\n|$)/y;
  for (let offset = 0; offset <= input.length;) {
    cell.lastIndex = offset;
    const match = cell.exec(input);
    if (!match) throw new ServiceError("INVITATION_CSV_INVALID", 400, "CSV 第 " + (records.length + 1) + " 行格式无效");
    row.push((match[1]?.replaceAll('""', '"') ?? match[2] ?? "").trim());
    offset = cell.lastIndex;
    if (input[offset] === ",") { offset++; continue; }
    if (row.some(Boolean)) records.push(row);
    row = [];
    offset += input.startsWith("\r\n",offset) ? 2 : 1;
  }
  const aliases = new Map([["name","名称"], ["employee number","工号"], ["department","部门名称"]]);
  const headers = (records.shift() ?? []).map(header => codeOnly ? aliases.get(header.toLowerCase()) ?? header : header);
  const required = codeOnly ? ["名称","工号"] : ["名称","工号","部门名称","角色"];
  if (!required.every(key => headers.includes(key)) || new Set(headers).size !== headers.length)
    throw new ServiceError("INVITATION_CSV_INVALID", 400, codeOnly ? "CSV 需要名称和工号两列" : "CSV 需要名称、工号、部门名称和角色四列");
  return records.map((record,index) => {
    const get = (key:string) => record[headers.indexOf(key)] ?? "";
    const role = codeOnly ? "member" : { "成员":"member", "普通成员":"member", "管理员":"admin" }[get("角色")];
    if (record.length !== headers.length || !get("名称") || !get("工号") || !role)
      throw new ServiceError("INVITATION_CSV_INVALID", 400, "CSV 第 " + (index + 2) + " 行的名称、工号或角色无效");
    return { name:get("名称"), employeeNumber:get("工号"), departmentName:get("部门名称") || null, role, email:codeOnly ? null : get("邮箱") || null };
  });
}
