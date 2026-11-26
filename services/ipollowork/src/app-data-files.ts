/** App attachments share the existing object store and quotas; records hold only the returned file reference. */
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Store } from './database.js';
import type { Storage } from './storage.js';
import type { AppData, DataCaller } from './app-data.js';
import { ServiceError } from './errors.js';
import { type Actor } from './auth.js';
import type { DeletionJobs } from './deletion-jobs.js';

const metadata=z.object({name:z.string().trim().min(1).max(200),public:z.boolean().default(false)}).strict();
/** Uploaded content never enters PostgreSQL; this class stores ownership and object identifiers only. */
export class AppDataFiles {
  private timer?:ReturnType<typeof setInterval>;
  private cleaning?:Promise<void>;
  private cursor="";
  constructor(private accounts:Store,private apps:AppData,private storage:Storage,private intervalMs:number) {}
  start():void {
    this.timer=setInterval(()=>{this.cleaning??=this.cleanup().catch(()=>console.error('App attachment cleanup failed; files remain charged')).finally(()=>{this.cleaning=undefined})},this.intervalMs);this.timer.unref();
  }
  async close():Promise<void> {clearInterval(this.timer);await this.cleaning;}
  async cleanup():Promise<void> {
    const rows=await this.accounts.all<{id:string;app_id:string;storage_key:string}>('SELECT id,app_id,storage_key FROM app_data_files WHERE id>? ORDER BY id LIMIT 100',this.cursor);
    const active=new Set((await this.apps.data.all<{id:string}>('SELECT id FROM data_apps WHERE deleted_at IS NULL AND id IN (SELECT jsonb_array_elements_text(?::jsonb))',JSON.stringify([...new Set(rows.map(row=>row.app_id))]))).map(row=>row.id));
    for(const row of rows){
      this.cursor=row.id;
      if(active.has(row.app_id))continue;
      await this.storage.remove(row.storage_key);
      await this.accounts.run('DELETE FROM app_data_files WHERE id=?',row.id);
    }
    if(rows.length<100)this.cursor='';
  }
  async upload(caller:DataCaller,appId:string,input:unknown,body:ReadableStream<Uint8Array>|null,bytes:number,mime:string,jobs:DeletionJobs) {
    const access=await this.apps.fileAccess(caller,appId,'write');
    const info=metadata.parse(input);
    if(info.public&&!access.manager)throw new ServiceError('DATA_FORBIDDEN',403,'只有应用管理者能公开附件');
    if(!body||!Number.isSafeInteger(bytes)||bytes<1||bytes>24*1024*1024)throw new ServiceError('UPLOAD_TOO_LARGE',413,'附件大小应为 1 字节至 24 MB');
    if(!/^[\w.+-]+\/[\w.+-]+$/.test(mime))throw new ServiceError('INVALID_UPLOAD',400,'文件类型无效');
    const id=randomUUID();
    const file=await this.storage.putStream(id,{userId:access.userId,organizationId:access.organizationId},mime,body,bytes,{permanent:true});
    await this.storage.persist(file.storageKey,async()=>{
      await jobs.lock('data-app',appId);
      if(await jobs.requested('data-app',appId))
        throw new ServiceError('DATA_APP_NOT_FOUND',404,'应用不存在');
      await this.apps.fileAccess(caller,appId,'write');
      await this.accounts.run('INSERT INTO app_data_files(id,app_id,created_by,name,mime,bytes,sha256,storage_key,is_public,created_at) VALUES(?,?,?,?,?,?,?,?,?,?)',id,appId,access.userId,info.name,mime,bytes,file.sha256,file.storageKey,info.public,Date.now());
    });
    await this.apps.fileAccess(caller,appId,'read');
    return {id,name:info.name,mime,bytes,sha256:file.sha256};
  }
  async download(caller:DataCaller,appId:string,id:string):Promise<Response> {
    const access=await this.apps.fileAccess(caller,appId,'read');
    const file=await this.file(appId,id);
    if(!file.is_public&&!access.manager&&file.created_by!==access.userId)throw new ServiceError('DATA_FORBIDDEN',403,'没有附件访问权限');
    return this.storage.download(file.storage_key,file.name);
  }
  async remove(caller:DataCaller,appId:string,id:string,jobs:DeletionJobs) {
    const access=await this.apps.fileAccess(caller,appId,'write');
    const actor:Actor=caller.kind==='member'?caller.actor:{id:access.userId,role:'user',name:'',email:''};
    const target=appId+'/'+z.uuid().parse(id);
    const job=await this.accounts.transaction(async()=>{
      await jobs.lock('data-app',appId);
      await jobs.lock('app-file',target);
      const existing=await jobs.existing('app-file',target,actor);
      if(existing)return existing;
      const file=await this.file(appId,id);
      if(!access.manager&&file.created_by!==access.userId)throw new ServiceError('DATA_FORBIDDEN',403,'没有附件删除权限');
      await this.storage.markForRemoval([file.storage_key]);
      await this.accounts.run('DELETE FROM app_data_files WHERE id=? AND app_id=?',id,appId);
      return jobs.enqueue('app-file',target,actor,[file.storage_key]);
    });
    return jobs.receipt(job);
  }

  async purgeApp(appId:string):Promise<boolean> {
    const rows=await this.accounts.all<{id:string;storage_key:string}>(
      'SELECT id,storage_key FROM app_data_files WHERE app_id=? ORDER BY id LIMIT 20',appId,
    );
    for(const row of rows){
      await this.storage.remove(row.storage_key);
      await this.accounts.run('DELETE FROM app_data_files WHERE app_id=? AND id=?',appId,row.id);
    }
    return !await this.accounts.one('SELECT 1 FROM app_data_files WHERE app_id=?',appId);
  }
  private async file(appId:string,id:string) {
    const row=await this.accounts.one<{storage_key:string;created_by:string;name:string;is_public:boolean}>('SELECT storage_key,created_by,name,is_public FROM app_data_files WHERE app_id=? AND id=?',appId,z.uuid().parse(id));
    if(!row)throw new ServiceError('DATA_FILE_NOT_FOUND',404,'附件不存在');
    return row;
  }
}
