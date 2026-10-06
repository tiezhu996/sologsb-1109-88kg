import { useMemo, useState } from 'react';
import { App as AntApp, Button, Popconfirm, Radio, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import StatBadge from '../components/common/StatBadge';
import EmptyPanel from '../components/common/EmptyPanel';
import { useConflictStore } from '../stores/conflictStore';
import { useHerbStore } from '../stores/herbStore';
import { useMethodStore } from '../stores/methodStore';
import { useBatchStore } from '../stores/batchStore';
import { useSampleStore } from '../stores/sampleStore';
import { CONFLICT_STATUS_LABELS, MERGE_TABLE_LABELS, type MergeConflict } from '../types/merge-conflict';
import { formatDate } from '../utils/degree';

const { Title, Paragraph, Text } = Typography;

type Filter = 'pending' | 'resolved' | 'all';

const STATUS_COLOR: Record<MergeConflict['status'], string> = {
  pending: 'orange',
  'kept-local': 'green',
  'took-incoming': 'blue',
};

const TABLE_TAG_COLOR: Record<MergeConflict['table'], string> = {
  herbs: 'green',
  methods: 'volcano',
  batches: 'geekblue',
  samples: 'purple',
};

/** 合并冲突处理台：同业务键记录两边都改过时在此逐条选定，处理记录持久化留痕 */
export default function ConflictCenter() {
  const { message } = AntApp.useApp();
  const conflicts = useConflictStore((s) => s.conflicts);
  const resolve = useConflictStore((s) => s.resolve);
  const [filter, setFilter] = useState<Filter>('pending');
  const [busyId, setBusyId] = useState<string | null>(null);

  const pendingCount = useMemo(() => conflicts.filter((c) => c.status === 'pending').length, [conflicts]);
  const resolvedCount = conflicts.length - pendingCount;

  const rows = useMemo(() => {
    if (filter === 'pending') return conflicts.filter((c) => c.status === 'pending');
    if (filter === 'resolved') return conflicts.filter((c) => c.status !== 'pending');
    return conflicts;
  }, [conflicts, filter]);

  const handleResolve = async (id: string, choice: 'local' | 'incoming') => {
    setBusyId(id);
    try {
      await resolve(id, choice);
      // 采用备份会覆盖本机记录，刷新各台账缓存
      await Promise.all([
        useHerbStore.getState().hydrate(),
        useMethodStore.getState().hydrate(),
        useBatchStore.getState().hydrate(),
        useSampleStore.getState().hydrate(),
      ]);
      message.success(choice === 'local' ? '已保留本机版本' : '已采用备份版本（保留本机 id 覆盖，引用不断链）');
    } catch (error) {
      message.error(`处理失败：${(error as Error).message}`);
    } finally {
      setBusyId(null);
    }
  };

  const columns: TableColumnsType<MergeConflict> = [
    {
      title: '类型',
      dataIndex: 'table',
      width: 100,
      render: (v: MergeConflict['table']) => <Tag color={TABLE_TAG_COLOR[v]}>{MERGE_TABLE_LABELS[v]}</Tag>,
    },
    { title: '记录', dataIndex: 'label', width: 200, render: (v: string) => <Text strong>{v}</Text> },
    {
      title: '差异字段',
      width: 220,
      render: (_, row) => (
        <Space wrap size={4}>
          {row.diffs.map((d) => (
            <Tag key={d.label}>{d.label}</Tag>
          ))}
        </Space>
      ),
    },
    { title: '检出时间', dataIndex: 'detectedAt', width: 110, render: (v: string) => formatDate(v) },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (v: MergeConflict['status'], row) => (
        <Space direction="vertical" size={2}>
          <Tag color={STATUS_COLOR[v]}>{CONFLICT_STATUS_LABELS[v]}</Tag>
          {row.resolvedAt ? <Text type="secondary" style={{ fontSize: 12 }}>{formatDate(row.resolvedAt)}</Text> : null}
        </Space>
      ),
    },
    {
      title: '操作',
      width: 210,
      render: (_, row) =>
        row.status === 'pending' ? (
          <Space>
            <Popconfirm
              title="保留本机版本"
              description="备份版本将被丢弃，本机记录保持不变。"
              onConfirm={() => void handleResolve(row.id, 'local')}
            >
              <Button size="small" loading={busyId === row.id}>
                保留本机
              </Button>
            </Popconfirm>
            <Popconfirm
              title="采用备份版本"
              description="以备份内容覆盖本机记录（保留本机 id，引用不断链）。"
              onConfirm={() => void handleResolve(row.id, 'incoming')}
            >
              <Button size="small" type="primary" loading={busyId === row.id}>
                采用备份
              </Button>
            </Popconfirm>
          </Space>
        ) : (
          <Text type="secondary">已处理</Text>
        ),
    },
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        合并冲突处理台
      </Title>
      <Paragraph type="secondary">
        备份与本机同业务键（药材名+批号 / 炮制方法 / 生产批号 / 留样编号）但内容不一致的记录在此列出；
        未处理前备份版本不会写入本机。处理结果持久化保存，重开仍在。
      </Paragraph>

      <Space style={{ marginBottom: 16 }} size={12} wrap>
        <StatBadge
          label="待处理冲突"
          value={pendingCount}
          unit="条"
          status={pendingCount > 0 ? 'error' : 'success'}
          hint="处理前备份版本不入本机"
        />
        <StatBadge label="已处理（留痕）" value={resolvedCount} unit="条" hint="处理记录重开仍在" />
        <Radio.Group
          value={filter}
          onChange={(e) => setFilter(e.target.value as Filter)}
          options={[
            { label: '待处理', value: 'pending' },
            { label: '已处理', value: 'resolved' },
            { label: '全部', value: 'all' },
          ]}
          optionType="button"
        />
      </Space>

      {rows.length === 0 ? (
        <EmptyPanel
          description={
            filter === 'pending' ? '暂无待处理冲突：同业务键记录均一致，或锁定批次已按锁定版本对账' : '暂无记录'
          }
        />
      ) : (
        <Table
          rowKey="id"
          size="small"
          columns={columns}
          dataSource={rows}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          expandable={{
            expandedRowRender: (row) => (
              <Table
                rowKey={(d) => d.label}
                size="small"
                pagination={false}
                showHeader={false}
                columns={[
                  { title: '字段', dataIndex: 'label', width: 160, render: (v: string) => <Text type="secondary">{v}</Text> },
                  {
                    title: '本机',
                    dataIndex: 'local',
                    render: (v: string) => <Text>{v}</Text>,
                  },
                  {
                    title: '备份',
                    dataIndex: 'incoming',
                    render: (v: string) => <Text type="warning">{v}</Text>,
                  },
                ]}
                dataSource={row.diffs}
              />
            ),
            rowExpandable: (row) => row.diffs.length > 0,
          }}
        />
      )}
    </div>
  );
}
