import { Button, Input, Select, Space, Tag } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { useSearchParams } from 'react-router-dom';

export interface FilterField {
  /** URL query 键名 */
  key: string;
  label: string;
  options: string[];
  width?: number;
}

export interface FilterBarProps {
  fields: FilterField[];
  /** 关键字查询的 URL 参数名，默认 kw */
  keywordKey?: string;
  keywordPlaceholder?: string;
  /** 命中条数，便于页面回显 */
  resultCount?: number;
  totalCount?: number;
  extra?: React.ReactNode;
}

/**
 * 关键字与多选条件下拉过滤条：条件直接同步到 URL query，
 * 刷新、分享链接、前进后退都能复现（药材台账、工序记录台复用）。
 */
export default function FilterBar({
  fields,
  keywordKey = 'kw',
  keywordPlaceholder = '搜索药材名 / 批号 / 备注',
  resultCount,
  totalCount,
  extra,
}: FilterBarProps) {
  const [params, setParams] = useSearchParams();

  const update = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) {
      next.set(key, value);
    } else {
      next.delete(key);
    }
    setParams(next, { replace: true });
  };

  const reset = () => {
    const next = new URLSearchParams(params);
    [keywordKey, ...fields.map((f) => f.key)].forEach((key) => next.delete(key));
    setParams(next, { replace: true });
  };

  const activeCount = [keywordKey, ...fields.map((f) => f.key)].filter((key) => params.get(key)).length;

  return (
    <Space wrap size={[8, 8]} style={{ marginBottom: 12 }} align="center">
      <Input.Search
        allowClear
        style={{ width: 240 }}
        placeholder={keywordPlaceholder}
        defaultValue={params.get(keywordKey) ?? ''}
        key={params.get(keywordKey) ?? ''}
        onSearch={(value) => update(keywordKey, value.trim())}
      />
      {fields.map((field) => (
        <span key={field.key}>
          <span style={{ color: '#6b7a70', marginRight: 6 }}>{field.label}</span>
          <Select
            allowClear
            style={{ width: field.width ?? 120 }}
            placeholder="全部"
            value={params.get(field.key) ?? undefined}
            options={field.options.map((option) => ({ label: option, value: option }))}
            onChange={(value?: string) => update(field.key, value ?? '')}
          />
        </span>
      ))}
      <Button icon={<ReloadOutlined />} onClick={reset} disabled={activeCount === 0}>
        重置
      </Button>
      {typeof resultCount === 'number' && typeof totalCount === 'number' ? (
        <Tag color={resultCount === totalCount ? 'default' : 'green'}>
          命中 {resultCount} / {totalCount}
        </Tag>
      ) : null}
      {extra}
    </Space>
  );
}
