import { useMemo } from 'react';
import { Alert, Button, Card, Col, Row, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import { Link } from 'react-router-dom';
import StatBadge from '../components/common/StatBadge';
import ProcessTimeline from '../components/common/ProcessTimeline';
import { useHerbStore } from '../stores/herbStore';
import { useMethodStore } from '../stores/methodStore';
import { useBatchStore } from '../stores/batchStore';
import { useSampleStore } from '../stores/sampleStore';
import { dueSamples, formatDate } from '../utils/degree';
import type { ProcessBatch } from '../types/process-batch';
import type { SampleExpiry } from '../types/retain-sample';

const { Title, Paragraph, Text } = Typography;

/** 首页：待炮制批次与留样到期提示 */
export default function ProcessBoard() {
  const herbs = useHerbStore((s) => s.herbs);
  const methods = useMethodStore((s) => s.methods);
  const batches = useBatchStore((s) => s.batches);
  const samples = useSampleStore((s) => s.samples);

  const pending = useMemo(() => batches.filter((b) => !b.locked), [batches]);
  const due = useMemo(() => dueSamples(samples, 30), [samples]);
  const degreeCount = useMemo(() => {
    return batches.reduce(
      (acc, b) => {
        acc[b.degree] += 1;
        return acc;
      },
      { 不及: 0, 适中: 0, 太过: 0 } as Record<ProcessBatch['degree'], number>,
    );
  }, [batches]);

  const avgYield = useMemo(() => {
    if (batches.length === 0) return 0;
    return Number((batches.reduce((sum, b) => sum + b.yieldRate, 0) / batches.length).toFixed(1));
  }, [batches]);

  const herbName = (id: string) => herbs.find((h) => h.id === id)?.name ?? '未知药材';
  const methodName = (id: string) => methods.find((m) => m.id === id)?.name ?? '未知方法';

  const pendingColumns: TableColumnsType<ProcessBatch> = [
    { title: '生产批号', dataIndex: 'batchNo', width: 130, render: (v: string) => <Text strong>{v}</Text> },
    { title: '药材', dataIndex: 'herbId', width: 100, render: (id: string) => herbName(id) },
    { title: '炮制方法', dataIndex: 'methodId', width: 100, render: (id: string) => methodName(id) },
    { title: '投料量(kg)', dataIndex: 'feedKg', width: 100, align: 'right' },
    { title: '辅料用量(kg)', dataIndex: 'auxUsedKg', width: 110, align: 'right' },
    {
      title: '得率(%)',
      dataIndex: 'yieldRate',
      width: 90,
      align: 'right',
      render: (v: number) => <Text type={v < 85 ? 'danger' : undefined}>{v}</Text>,
    },
    {
      title: '火候',
      dataIndex: 'fireLevel',
      width: 90,
      render: (v: string) => <Tag color={v === '武火' ? 'red' : v === '中火' ? 'orange' : 'green'}>{v}</Tag>,
    },
    { title: '操作人', dataIndex: 'operator', width: 90 },
    { title: '开始时间', dataIndex: 'startedAt', width: 150, render: (v: string) => formatDate(v) },
  ];

  const dueColumns: TableColumnsType<SampleExpiry> = [
    { title: '留样编号', width: 150, render: (_, row) => <Text strong>{row.sample.sampleNo}</Text> },
    { title: '柜位', width: 80, render: (_, row) => row.sample.cabinet },
    { title: '留样量(g)', width: 90, align: 'right', render: (_, row) => row.sample.amountG },
    { title: '到期日', width: 110, render: (_, row) => row.expireAt },
    {
      title: '剩余天数',
      width: 100,
      align: 'right',
      render: (_, row) => (
        <Text type={row.daysLeft < 0 ? 'danger' : row.daysLeft <= 30 ? 'warning' : undefined}>
          {row.daysLeft < 0 ? `已过期 ${Math.abs(row.daysLeft)} 天` : `${row.daysLeft} 天`}
        </Text>
      ),
    },
    {
      title: '状态',
      width: 90,
      render: (_, row) => (
        <Tag color={row.state === '已到期' ? 'red' : row.state === '临期' ? 'orange' : 'green'}>{row.state}</Tag>
      ),
    },
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        中草药炮制工序记录台
      </Title>
      <Paragraph type="secondary">
        按投料量折算辅料、记录火候与得率、逐批判定炮制程度并管理留样观察。数据全部保存在浏览器本地（IndexedDB：
        gbherbprocess-db）。
      </Paragraph>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <StatBadge label="待炮制（未锁定）批次" value={pending.length} unit="批" status="warning" hint="得率与程度判定提交后即锁定" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="在册药材批次" value={herbs.length} unit="批" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="30 天内到期留样" value={due.length} unit="份" status={due.length > 0 ? 'error' : 'success'} />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="平均得率" value={avgYield} unit="%" status="success" hint={`适中 ${degreeCount['适中']} / 不及 ${degreeCount['不及']} / 太过 ${degreeCount['太过']}`} />
        </Col>
      </Row>

      {due.length > 0 ? (
        <Alert
          style={{ marginBottom: 16 }}
          type="warning"
          showIcon
          message={`留样到期提醒：${due.length} 份留样已到期或将在 30 天内到期`}
          description={
            <Space wrap>
              {due.slice(0, 6).map((item) => (
                <Tag key={item.sample.id} color={item.daysLeft < 0 ? 'red' : 'orange'}>
                  {item.sample.sampleNo}（柜位 {item.sample.cabinet}
                  {item.daysLeft < 0 ? `，已过期 ${Math.abs(item.daysLeft)} 天` : `，剩 ${item.daysLeft} 天`}）
                </Tag>
              ))}
              <Link to="/samples">
                <Button size="small" type="link">
                  前往留样台账处理
                </Button>
              </Link>
            </Space>
          }
        />
      ) : null}

      <Row gutter={[16, 16]}>
        <Col xs={24} lg={15}>
          <Card
            title="待炮制批次"
            size="small"
            extra={
              <Link to="/batches">
                <Button size="small" type="primary">
                  去工序记录台
                </Button>
              </Link>
            }
          >
            <Table
              rowKey="id"
              size="small"
              columns={pendingColumns}
              dataSource={pending}
              pagination={{ pageSize: 6, hideOnSinglePage: true }}
              scroll={{ x: 900 }}
            />
          </Card>
        </Col>
        <Col xs={24} lg={9}>
          <Card title="最近炮制工序" size="small" style={{ marginBottom: 16 }}>
            <ProcessTimeline batches={batches} herbs={herbs} methods={methods} limit={5} />
          </Card>
          <Card title="留样到期提示" size="small">
            <Table
              rowKey={(row) => row.sample.id}
              size="small"
              columns={dueColumns}
              dataSource={due.slice(0, 6)}
              pagination={false}
              locale={{ emptyText: '暂无临期或到期留样' }}
            />
          </Card>
        </Col>
      </Row>
    </div>
  );
}
