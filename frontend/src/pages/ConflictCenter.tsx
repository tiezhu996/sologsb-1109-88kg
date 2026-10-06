import { useMemo, useState } from 'react';
import { Alert, App as AntApp, Button, Card, Col, Empty, Popconfirm, Row, Space, Table, Tag, Timeline, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import {
  CheckCircleOutlined,
  ClockCircleOutlined,
  LockOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { useSyncStore } from '../stores/syncStore';
import { useHerbStore } from '../stores/herbStore';
import { useMethodStore } from '../stores/methodStore';
import { useBatchStore } from '../stores/batchStore';
import { useSampleStore } from '../stores/sampleStore';
import { CONFLICT_FIELDS } from '../utils/sync';
import { formatDate } from '../utils/degree';
import { SYNC_TABLE_LABEL, type MergeConflict } from '../types/sync';

const { Title, Paragraph, Text } = Typography;

function formatValue(value: unknown): string {
  if (value === undefined || value === null || value === '') return '—';
  if (typeof value === 'boolean') return value ? '是' : '否';
  if (Array.isArray(value)) {
    if (value.length === 2 && value.every((n) => typeof n === 'number')) return `${value[0]} ~ ${value[1]}`;
    if (value.length > 0 && typeof value[0] === 'object') return `${value.length} 条观察记录`;
    return value.join(' / ');
  }
  if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) return formatDate(value);
  return String(value);
}

/** 对账中心：未决冲突逐条选择，已处理记录（含锁定自动裁定）重开仍在 */
export default function ConflictCenter() {
  const { message } = AntApp.useApp();
  const conflicts = useSyncStore((s) => s.conflicts);
  const sessions = useSyncStore((s) => s.sessions);
  const resolveConflict = useSyncStore((s) => s.resolveConflict);
  const hydrateHerbs = useHerbStore((s) => s.hydrate);
  const hydrateMethods = useMethodStore((s) => s.hydrate);
  const hydrateBatches = useBatchStore((s) => s.hydrate);
  const hydrateSamples = useSampleStore((s) => s.hydrate);
  const [busyId, setBusyId] = useState<string | null>(null);

  const pending = useMemo(() => conflicts.filter((c) => c.status === 'pending'), [conflicts]);
  const resolved = useMemo(() => conflicts.filter((c) => c.status === 'resolved'), [conflicts]);

  const decide = async (conflict: MergeConflict, side: 'local' | 'remote') => {
    setBusyId(conflict.id);
    try {
      await resolveConflict(conflict.id, side);
      await Promise.all([hydrateHerbs(), hydrateMethods(), hydrateBatches(), hydrateSamples()]);
      message.success(`已选择保留${side === 'local' ? '本机' : '备份'}版本，关联批次/留样已自动续传`);
    } catch (e) {
      message.error((e as Error).message);
    } finally {
      setBusyId(null);
    }
  };

  const columns: TableColumnsType<MergeConflict> = [
    {
      title: '类型',
      dataIndex: 'table',
      width: 100,
      render: (table: MergeConflict['table']) => <Tag color="geekblue">{SYNC_TABLE_LABEL[table]}</Tag>,
    },
    { title: '记录', dataIndex: 'title', render: (v: string) => <Text strong>{v}</Text> },
    {
      title: '自然键（对账依据）',
      dataIndex: 'naturalKey',
      width: 200,
      render: (v: string) => <Text type="secondary" style={{ fontSize: 12 }}>{v}</Text>,
    },
    { title: '来源备份', dataIndex: 'sourceName', width: 180, ellipsis: true },
    {
      title: '状态',
      dataIndex: 'status',
      width: 200,
      render: (status: MergeConflict['status'], record) => {
        if (status === 'pending') {
          return (
            <Tag icon={<ClockCircleOutlined />} color="orange">
              未决（备份侧暂不入本机）
            </Tag>
          );
        }
        const isLock = Boolean(record.autoReason?.includes('锁定'));
        return (
          <Space size={4} direction="vertical">
            <Tag icon={<CheckCircleOutlined />} color="green">
              已处理 · {record.resolution === 'local' ? '保留本机' : '采用备份'}
            </Tag>
            {isLock ? <Tag icon={<LockOutlined />} color="blue">锁定批次自动裁定</Tag> : null}
          </Space>
        );
      },
    },
    {
      title: '操作',
      width: 200,
      render: (_, record) =>
        record.status === 'pending' ? (
          <Space size={4}>
            <Button size="small" onClick={() => decide(record, 'local')} loading={busyId === record.id}>
              保留本机
            </Button>
            <Button size="small" type="primary" ghost onClick={() => decide(record, 'remote')} loading={busyId === record.id}>
              采用备份
            </Button>
          </Space>
        ) : (
          <Text type="secondary" style={{ fontSize: 12 }}>
            {record.autoReason ?? (record.resolvedAt ? `${formatDate(record.resolvedAt)} 裁决` : '')}
          </Text>
        ),
    },
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        对账中心
      </Title>
      <Paragraph type="secondary">
        他机备份按药材名+批号、炮制方法、生产批号、留样编号与本机对账。同名记录两侧都改过在此逐字段对比选择，未决前备份侧记录不入本机；炮制批次一经锁定以锁定版本为准并自动裁定。所有处理记录重开仍在。
      </Paragraph>

      <Alert
        style={{ marginBottom: 16 }}
        type={pending.length > 0 ? 'warning' : 'success'}
        showIcon
        icon={<SafetyCertificateOutlined />}
        message={
          pending.length > 0
            ? `有 ${pending.length} 条冲突等待选择，处理后被挂起的批次/留样会自动续传并入`
            : resolved.length > 0
              ? `没有待决冲突，历史处理记录 ${resolved.length} 条已留存`
              : '暂无对账冲突'
        }
      />

      {pending.length === 0 && resolved.length === 0 ? (
        <Empty description="尚未导入过他机备份，或导入未产生冲突" style={{ padding: '40px 0' }} />
      ) : null}

      {pending.length > 0 ? (
        <Card size="small" title={`待选择冲突（${pending.length}）`} style={{ marginBottom: 16 }}>
          {pending.map((conflict) => (
            <ConflictDiff
              key={conflict.id}
              conflict={conflict}
              busy={busyId === conflict.id}
              onDecide={(side) => decide(conflict, side)}
            />
          ))}
        </Card>
      ) : null}

      {(pending.length > 0 || resolved.length > 0) ? (
        <Card size="small" title="对账记录（含已处理，重开仍在）">
          <Table
            rowKey="id"
            size="small"
            columns={columns}
            dataSource={[...pending, ...resolved]}
            pagination={{ pageSize: 10 }}
            expandable={{
              expandedRowRender: (record) =>
                record.status === 'pending' ? null : (
                  <div style={{ padding: '8px 12px' }}>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      裁定结果：{record.resolution === 'local' ? '保留本机版本' : '采用备份版本'}
                      {record.autoReason ? `（${record.autoReason}）` : ''}
                    </Text>
                  </div>
                ),
              rowExpandable: (record) => record.status === 'resolved',
            }}
          />
        </Card>
      ) : null}

      {sessions.length > 0 ? (
        <Card size="small" title="导入会话" style={{ marginTop: 16 }}>
          <Timeline
            items={sessions.slice(0, 8).map((session) => ({
              color: session.status === 'failed' ? 'red' : session.status === 'conflicts' ? 'orange' : 'green',
              children: (
                <Space direction="vertical" size={0}>
                  <Text>
                    {session.fileName}
                    <Tag style={{ marginLeft: 8 }} color={session.status === 'done' ? 'green' : session.status === 'failed' ? 'red' : 'orange'}>
                      {sessionStatusLabel(session.status)}
                    </Tag>
                  </Text>
                  <Text type="secondary" style={{ fontSize: 12 }}>
                    备份版本 v{session.schemaVersion} · 暂存 {session.stagedRows}/{session.totalRows} 行 · {formatDate(session.createdAt)}
                    {session.status === 'failed' ? ` · 失败：${session.error ?? '未知错误'}（本机库未改动，可在导入窗口重试）` : ''}
                  </Text>
                </Space>
              ),
            }))}
          />
        </Card>
      ) : null}
    </div>
  );
}

function sessionStatusLabel(status: string): string {
  switch (status) {
    case 'done':
      return '已完成';
    case 'conflicts':
      return '有待决冲突';
    case 'failed':
      return '失败可重试';
    case 'staged':
      return '待合并';
    default:
      return status;
  }
}

/** 单条冲突的逐字段对比 */
function ConflictDiff({
  conflict,
  busy,
  onDecide,
}: {
  conflict: MergeConflict;
  busy: boolean;
  onDecide: (side: 'local' | 'remote') => void;
}) {
  const fields = CONFLICT_FIELDS[conflict.table];
  const diffFields = useMemo(
    () => fields.filter((f) => formatValue(conflict.local[f.key]) !== formatValue(conflict.remote[f.key])),
    [fields, conflict],
  );
  const sameFields = fields.filter((f) => !diffFields.includes(f));

  return (
    <Card
      size="small"
      type="inner"
      style={{ marginBottom: 12 }}
      title={
        <Space wrap>
          <Tag color="geekblue">{SYNC_TABLE_LABEL[conflict.table]}</Tag>
          <Text strong>{conflict.title}</Text>
          <Text type="secondary" style={{ fontSize: 12 }}>
            对账键：{conflict.naturalKey}
          </Text>
        </Space>
      }
      extra={
        <Space>
          <Popconfirm title="保留本机版本？备份侧该记录将不并入" onConfirm={() => onDecide('local')}>
            <Button size="small" loading={busy}>保留本机</Button>
          </Popconfirm>
          <Popconfirm title="采用备份版本？将覆盖本机该记录" onConfirm={() => onDecide('remote')}>
            <Button size="small" type="primary" ghost loading={busy}>采用备份</Button>
          </Popconfirm>
        </Space>
      }
    >
      <Row gutter={8} style={{ fontWeight: 600, marginBottom: 4 }}>
        <Col span={6}>字段</Col>
        <Col span={9}>本机版本{conflict.localUpdatedAt ? <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>（改于 {formatDate(conflict.localUpdatedAt)}）</Text> : null}</Col>
        <Col span={9}>备份版本 · {conflict.sourceName}{conflict.remoteUpdatedAt ? <Text type="secondary" style={{ fontSize: 11, fontWeight: 400 }}>（改于 {formatDate(conflict.remoteUpdatedAt)}）</Text> : null}</Col>
      </Row>
      {diffFields.map((f) => (
        <Row key={f.key} gutter={8} style={{ padding: '4px 0', background: '#fffbe6', borderRadius: 4 }}>
          <Col span={6}><Text strong>{f.label}</Text></Col>
          <Col span={9}><Text>{formatValue(conflict.local[f.key])}</Text></Col>
          <Col span={9}><Text>{formatValue(conflict.remote[f.key])}</Text></Col>
        </Row>
      ))}
      {sameFields.length > 0 ? (
        <Paragraph type="secondary" style={{ fontSize: 12, marginTop: 8, marginBottom: 0 }}>
          一致字段：{sameFields.map((f) => f.label).join('、')}
        </Paragraph>
      ) : null}
    </Card>
  );
}
