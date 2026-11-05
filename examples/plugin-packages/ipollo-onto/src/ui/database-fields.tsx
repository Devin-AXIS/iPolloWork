import { translate as tr, useLocale } from './i18n'
import { useState } from 'react'
import { Button, Select, Switch, TextArea, TextField } from '@radix-ui/themes'
import { CheckCircledIcon } from '@radix-ui/react-icons'
import type { DatabaseChoice, DatabaseConnection, DatabaseCheck } from '../core/database'
import { api, message } from './api'
import { ErrorNotice, FormLabel } from './components/primitives'
const initial: DatabaseConnection = {
  engine: 'postgres',
  host: '127.0.0.1',
  port: 5432,
  database: '',
  user: '',
  password: '',
  ssl: 'disable',
  ca: '',
}

export function DatabaseFields({
  value,
  onChange,
  disabled,
}: {
  value: DatabaseChoice
  onChange: (value: DatabaseChoice) => void
  disabled: boolean
}) {
  useLocale()
  const [connection, setConnection] = useState<DatabaseConnection>(
    value.mode === 'independent' ? value.connection : initial,
  )
  const [checking, setChecking] = useState(false),
    [error, setError] = useState(''),
    [result, setResult] = useState<DatabaseCheck>()
  function change(key: keyof DatabaseConnection, next: string | number) {
    const updated = { ...connection, [key]: next }
    setConnection(updated)
    onChange({ mode: 'independent', connection: updated })
    setError('')
    setResult(undefined)
  }
  async function test() {
    setChecking(true)
    setResult(undefined)
    setError('')
    try {
      setResult(await api<DatabaseCheck>('/databases/test', 'POST', connection))
    } catch (e) {
      setError(message(e))
    } finally {
      setChecking(false)
    }
  }
  return (
    <fieldset className="database-fields" disabled={disabled || checking}>
      <legend>{tr('项目数据库')}</legend>
      <div className="database-choices" role="group" aria-label={tr('项目数据库')}>
        <button
          type="button"
          aria-pressed={value.mode === 'default'}
          onClick={() => onChange({ mode: 'default' })}
        >
          <b>{tr('默认数据库')}</b>
          <span>{tr('直接开始，按项目组织数据')}</span>
        </button>
        <button
          type="button"
          aria-pressed={value.mode === 'independent'}
          onClick={() => onChange({ mode: 'independent', connection })}
        >
          <b>{tr('独立数据库')}</b>
          <span>{tr('连接专属的数据库存储')}</span>
        </button>
      </div>
      {value.mode === 'independent' && (
        <div className="database-config form-stack">
          <FormLabel label={tr('数据库类型')}>
            <Select.Root
              value={connection.engine}
              onValueChange={(v) => change('engine', v)}
              disabled={disabled || checking}
            >
              <Select.Trigger aria-label={tr('数据库类型')} />
              <Select.Content>
                <Select.Item value="postgres">PostgreSQL</Select.Item>
                <Select.Item value="highgo">{tr('瀚高 · PostgreSQL 兼容连接')}</Select.Item>
              </Select.Content>
            </Select.Root>
          </FormLabel>
          {connection.engine === 'highgo' && (
            <p className="form-hint">
              {tr('适用于 PostgreSQL 兼容模式；瀚高版本需实机验证，不代表信创认证。')}
            </p>
          )}
          <div className="database-host-row">
            <FormLabel label={tr('主机地址')}>
              <TextField.Root
                required
                value={connection.host}
                onChange={(e) => change('host', e.target.value)}
                placeholder={tr('数据库主机或 IP')}
              />
            </FormLabel>
            <FormLabel label={tr('端口')}>
              <TextField.Root
                required
                type="number"
                min={1}
                max={65535}
                value={connection.port || ''}
                onChange={(e) => change('port', Number(e.target.value))}
              />
            </FormLabel>
          </div>
          <FormLabel label={tr('数据库名称')}>
            <TextField.Root
              required
              value={connection.database}
              maxLength={63}
              onChange={(e) => change('database', e.target.value)}
              placeholder={tr('例如：sales_data')}
            />
          </FormLabel>
          <div className="database-login-row">
            <FormLabel label={tr('用户名')}>
              <TextField.Root
                required
                value={connection.user}
                maxLength={63}
                autoComplete="off"
                onChange={(e) => change('user', e.target.value)}
              />
            </FormLabel>
            <FormLabel label={tr('密码')}>
              <TextField.Root
                type="password"
                value={connection.password}
                maxLength={1024}
                autoComplete="new-password"
                onChange={(e) => change('password', e.target.value)}
                placeholder={tr('无密码可留空')}
              />
            </FormLabel>
          </div>
          <label className="switch-row">
            <span>{tr('加密连接（TLS）')}</span>
            <Switch
              checked={connection.ssl === 'verify-full'}
              onCheckedChange={(v) => change('ssl', v ? 'verify-full' : 'disable')}
              aria-label={tr('加密连接 TLS')}
              disabled={disabled || checking}
            />
          </label>
          {connection.ssl === 'verify-full' && (
            <details>
              <summary className="form-hint">{tr('自定义 CA 证书（可选）')}</summary>
              <TextArea
                aria-label={tr('CA 证书')}
                value={connection.ca}
                onChange={(e) => change('ca', e.target.value)}
                placeholder={tr('PEM 格式证书；留空使用系统信任证书')}
              />
            </details>
          )}
          <p className="form-hint">
            {tr(
              '连接已存在的数据库，并建立项目专属数据空间。原有业务表不会自动导入；连接凭据仅在服务端加密保存。',
            )}
          </p>
          <div className="database-check">
            <Button
              type="button"
              color="gray"
              variant="soft"
              onClick={test}
              loading={checking}
              disabled={!connection.host || !connection.database || !connection.user}
            >
              {tr('测试连接')}
            </Button>
            {result && (
              <span role="status">
                <CheckCircledIcon />
                {tr('连接成功 ·')}
                {result.latencyMs} ms
              </span>
            )}
          </div>
          <ErrorNotice error={error} />
        </div>
      )}
    </fieldset>
  )
}
