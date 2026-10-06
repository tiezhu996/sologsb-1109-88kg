import { useMemo, useState } from 'react';
import { App as AntApp, Button, Card, Col, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import StatBadge from '../components/common/StatBadge';
import CabinetGrid from '../components/common/CabinetGrid';
import EmptyPanel from '../components/common/EmptyPanel';
import { useSampleStore } from '../stores/sampleStore';
import { useBatchStore } from '../stores/batchStore';
import { useHerbStore } from '../stores/herbStore';
import { CABINETS, type ObserveLog, type RetainSample, type SampleExpiry } from '../types/retain-sample';
import { buildExpiryList, formatDate, todayStr } from '../utils/degree';

const { Title, Paragraph, Text } = Typography;

interface SampleFormValues {
  sampleNo: string;
  batchId: string;
  amountG: number;
  retainMonths: number;
  cabinet: string;
  retainedAt: Dayjs;
}

interface ObserveFormValues {
  date: Dayjs;
  color: string;
  odor: string;
  mold: string;
  observer: string;
  note?: string;
}

const STATE_COLOR: Record<SampleExpiry['state'], string> = { 已到期: 'red', 临期: 'orange', 观察中: 'green' };

/** 留样与观察台账：按柜位网格查看并追加观察记录 */
export default function SampleLedger() {
  const { message } = AntApp.useApp();
  const samples = useSampleStore((s) => s.samples);
  const createSample = useSampleStore((s) => s.createSample);
  const removeSample = useSampleStore((s) => s.removeSample);
  const appendObserveLog = useSampleStore((s) => s.appendObserveLog);
  const batches = useBatchStore((s) => s.batches);
  const herbs = useHerbStore((s) => s.herbs);

  const [selectedCabinet, setSelectedCabinet] = useState<string | undefined>(undefined);
  const [open, setOpen] = useState(false);
  const [form] = Form.useForm<SampleFormValues>();
  const [observeTarget, setObserveTarget] = useState<RetainSample | null>(null);
  const [observeForm] = Form.useForm<ObserveFormValues>();

  const expiryList = useMemo(() => buildExpiryList(samples, 30), [samples]);
  const dueList = useMemo(() => expiryList.filter((item) => item.daysLeft <= 30), [expiryList]);
  const expired = useMemo(() => expiryList.filter((item) => item.daysLeft < 0), [expiryList]);

  const visible = useMemo(
    () => (selectedCabinet ? expiryList.filter((item) => item.sample.cabinet === selectedCabinet) : expiryList),
    [expiryList, selectedCabinet],
  );

  const batchLabel = (batchId: string) => {
    const batch = batches.find((b) => b.id === batchId);
    if (!batch) return '未知批次';
    const herb = herbs.find((h) => h.id === batch.herbId);
    return `${batch.batchNo} · ${herb?.name ?? '未知药材'} · 得率 ${batch.yieldRate}%`;
  };

  const openCreate = () => {
    const nextIndex = samples.length + 1;
    const batch = batches[0];
    form.resetFields();
    form.setFieldsValue({
      sampleNo: `LY-${batch?.batchNo ?? 'NEW'}-${String(nextIndex).padStart(2, '0')}`,
      batchId: batch?.id,
      amountG: 300,
      retainMonths: 12,
      cabinet: CABINETS.find((c) => !expiryList.some((item) => item.sample.cabinet === c)) ?? CABINETS[0],
      retainedAt: dayjs(),
    } as unknown as SampleFormValues);
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const occupied = expiryList.some((item) => item.sample.cabinet === values.cabinet);
    if (occupied) {
      message.warning(`柜位 ${values.cabinet} 已有留样，仍将并存放置`);
    }
    await createSample({
      sampleNo: values.sampleNo,
      batchId: values.batchId,
      amountG: values.amountG,
      retainMonths: values.retainMonths,
      cabinet: values.cabinet,
      retainedAt: values.retainedAt.toISOString(),
    });
    message.success(`已登记留样 ${values.sampleNo}`);
    setOpen(false);
  };

  const openObserve = (record: RetainSample) => {
    setObserveTarget(record);
    observeForm.resetFields();
    observeForm.setFieldsValue({ date: dayjs(), color: '色泽符合标准', odor: '气味正常', mold: '无霉变', observer: '赵敏' } as unknown as ObserveFormValues);
  };

  const submitObserve = async () => {
    if (!observeTarget) return;
    const values = await observeForm.validateFields();
    await appendObserveLog(observeTarget.id, {
      date: values.date.format('YYYY-MM-DD'),
      color: values.color,
      odor: values.odor,
      mold: values.mold,
      observer: values.observer,
      note: values.note,
    });
    const refreshed = useSampleStore.getState().samples.find((s) => s.id === observeTarget.id);
    if (refreshed) {
      setObserveTarget(refreshed);
    }
    message.success('观察记录已按日期追加');
  };

  const columns: TableColumnsType<SampleExpiry> = [
    { title: '留样编号', width: 170, render: (_, row) => <Text strong>{row.sample.sampleNo}</Text> },
    { title: '关联批次', width: 260, render: (_, row) => batchLabel(row.sample.batchId) },
    { title: '留样量(g)', width: 100, align: 'right', render: (_, row) => row.sample.amountG },
    { title: '留样期(月)', width: 100, align: 'right', render: (_, row) => row.sample.retainMonths },
    { title: '柜位', width: 80, render: (_, row) => <Tag color="green">{row.sample.cabinet}</Tag> },
    { title: '留样日期', width: 110, render: (_, row) => formatDate(row.sample.retainedAt) },
    { title: '到期日', width: 110, render: (_, row) => row.expireAt },
    {
      title: '剩余天数',
      width: 110,
      align: 'right',
      render: (_, row) => (
        <Text type={row.daysLeft < 0 ? 'danger' : row.daysLeft <= 30 ? 'warning' : undefined}>
          {row.daysLeft < 0 ? `过期 ${Math.abs(row.daysLeft)} 天` : `${row.daysLeft} 天`}
        </Text>
      ),
    },
    { title: '状态', width: 90, render: (_, row) => <Tag color={STATE_COLOR[row.state]}>{row.state}</Tag> },
    { title: '观察记录', width: 100, align: 'right', render: (_, row) => `${row.sample.observeLogs.length} 条` },
    {
      title: '操作',
      width: 160,
      fixed: 'right',
      render: (_, row) => (
        <Space size={2}>
          <Button size="small" type="link" onClick={() => openObserve(row.sample)}>
            追加观察
          </Button>
          <Popconfirm title={`确认删除留样 ${row.sample.sampleNo}？`} onConfirm={() => removeSample(row.sample.id).then(() => message.success('已删除'))}>
            <Button size="small" type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  const observeColumns: TableColumnsType<ObserveLog> = [
    { title: '观察日期', dataIndex: 'date', width: 110 },
    { title: '色泽', dataIndex: 'color', width: 140 },
    { title: '气味', dataIndex: 'odor', width: 120 },
    { title: '霉变', dataIndex: 'mold', width: 120 },
    { title: '观察人', dataIndex: 'observer', width: 90 },
    { title: '备注', dataIndex: 'note', render: (v?: string) => v ?? '-' },
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        留样与观察台账
      </Title>
      <Paragraph type="secondary">按柜位网格查看占用与到期状态，观察记录按日期追加；到期前 30 天进入提醒清单。</Paragraph>

      <Row gutter={[12, 12]} style={{ marginBottom: 16 }}>
        <Col xs={12} md={6}>
          <StatBadge label="留样总数" value={samples.length} unit="份" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="观察中" value={expiryList.length - dueList.length} unit="份" status="success" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="30 天内到期" value={dueList.length - expired.length} unit="份" status="warning" />
        </Col>
        <Col xs={12} md={6}>
          <StatBadge label="已到期" value={expired.length} unit="份" status={expired.length ? 'error' : 'success'} />
        </Col>
      </Row>

      <Card
        size="small"
        title="留样柜位网格"
        style={{ marginBottom: 16 }}
        extra={
          <Space>
            {selectedCabinet ? <Tag color="green">已选柜位 {selectedCabinet}</Tag> : <Text type="secondary">点击柜位可筛选下方台账</Text>}
            {selectedCabinet ? <Button size="small" onClick={() => setSelectedCabinet(undefined)}>清除柜位筛选</Button> : null}
            <Button size="small" type="primary" onClick={openCreate}>
              登记留样
            </Button>
          </Space>
        }
      >
        <CabinetGrid expiryList={expiryList} selected={selectedCabinet} onSelect={(cabinet) => setSelectedCabinet(cabinet)} />
      </Card>

      {visible.length === 0 ? (
        <EmptyPanel description={selectedCabinet ? `柜位 ${selectedCabinet} 暂无留样` : '暂无留样记录'} actionText="登记留样" onAction={openCreate} />
      ) : (
        <Table rowKey={(row) => row.sample.id} size="small" columns={columns} dataSource={visible} pagination={{ pageSize: 8 }} scroll={{ x: 1400 }} />
      )}

      <Modal open={open} title="登记留样" onCancel={() => setOpen(false)} onOk={submit} okText="保存" cancelText="取消" width={560}>
        <Form form={form} layout="vertical">
          <Form.Item name="sampleNo" label="留样编号" rules={[{ required: true, message: '请输入留样编号' }]}>
            <Input maxLength={32} />
          </Form.Item>
          <Form.Item name="batchId" label="关联炮制批次" rules={[{ required: true, message: '请选择关联批次' }]}>
            <Select showSearch optionFilterProp="label" options={batches.map((b) => ({ label: batchLabel(b.id), value: b.id }))} />
          </Form.Item>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="amountG" label="留样量(g)" rules={[{ required: true, message: '请输入留样量' }]}>
              <InputNumber min={0} style={{ width: 150 }} />
            </Form.Item>
            <Form.Item name="retainMonths" label="留样期(月)" rules={[{ required: true, message: '请选择留样期' }]}>
              <Select style={{ width: 150 }} options={[3, 6, 12, 18, 24, 36].map((m) => ({ label: `${m} 个月`, value: m }))} />
            </Form.Item>
          </Space>
          <Form.Item name="cabinet" label="柜位" rules={[{ required: true, message: '请选择柜位' }]}>
            <Select showSearch options={CABINETS.map((c) => ({ label: c, value: c }))} />
          </Form.Item>
          <Form.Item name="retainedAt" label="留样日期" rules={[{ required: true, message: '请选择留样日期' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={Boolean(observeTarget)}
        title={`留样观察记录 · ${observeTarget?.sampleNo ?? ''}`}
        onCancel={() => setObserveTarget(null)}
        footer={null}
        width={760}
      >
        <Table
          rowKey="id"
          size="small"
          style={{ marginBottom: 12 }}
          columns={observeColumns}
          dataSource={observeTarget?.observeLogs ?? []}
          pagination={false}
          locale={{ emptyText: '暂无观察记录，请在下方追加' }}
        />
        <Form form={observeForm} layout="vertical">
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="date" label="观察日期" rules={[{ required: true, message: '请选择观察日期' }]}>
              <DatePicker style={{ width: 170 }} />
            </Form.Item>
            <Form.Item name="observer" label="观察人" rules={[{ required: true, message: '请输入观察人' }]}>
              <Input style={{ width: 140 }} maxLength={16} />
            </Form.Item>
          </Space>
          <Space size={12} style={{ display: 'flex' }} align="start">
            <Form.Item name="color" label="色泽" rules={[{ required: true, message: '请填写色泽观察' }]}>
              <Input style={{ width: 200 }} maxLength={30} />
            </Form.Item>
            <Form.Item name="odor" label="气味" rules={[{ required: true, message: '请填写气味观察' }]}>
              <Input style={{ width: 200 }} maxLength={30} />
            </Form.Item>
            <Form.Item name="mold" label="霉变" rules={[{ required: true, message: '请填写霉变观察' }]}>
              <Input style={{ width: 200 }} maxLength={30} />
            </Form.Item>
          </Space>
          <Form.Item name="note" label="备注">
            <Input.TextArea rows={2} maxLength={80} />
          </Form.Item>
          <Space>
            <Button type="primary" onClick={submitObserve}>
              追加本次观察（{todayStr()}）
            </Button>
            <Button onClick={() => setObserveTarget(null)}>关闭</Button>
          </Space>
        </Form>
      </Modal>
    </div>
  );
}
