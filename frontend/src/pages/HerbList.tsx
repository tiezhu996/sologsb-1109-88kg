import { useMemo, useState } from 'react';
import { App as AntApp, Button, Card, DatePicker, Form, Input, InputNumber, Modal, Popconfirm, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import FilterBar from '../components/common/FilterBar';
import EmptyPanel from '../components/common/EmptyPanel';
import { useHerbFilter } from '../hooks/useHerbFilter';
import { useHerbStore } from '../stores/herbStore';
import { HERB_ORIGINS, HERB_PARTS, type HerbMaterial } from '../types/herb-material';
import { formatDate } from '../utils/degree';

const { Title, Paragraph, Text } = Typography;

interface HerbFormValues {
  name: string;
  origin: HerbMaterial['origin'];
  part: HerbMaterial['part'];
  batchNo: string;
  feedKg: number;
  receivedAt: Dayjs;
  remark?: string;
}

/** 药材与批次台账，按基原与药用部位筛选 */
export default function HerbList() {
  const { message } = AntApp.useApp();
  const herbs = useHerbStore((s) => s.herbs);
  const addHerb = useHerbStore((s) => s.addHerb);
  const updateHerb = useHerbStore((s) => s.updateHerb);
  const removeHerb = useHerbStore((s) => s.removeHerb);
  const filter = useHerbFilter();
  const [form] = Form.useForm<HerbFormValues>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<HerbMaterial | null>(null);

  const visible = useMemo(() => filter.apply(herbs), [herbs, filter]);

  const summary = useMemo(() => {
    const map = new Map<string, { name: string; origin: string; part: string; batches: number; kg: number }>();
    visible.forEach((herb) => {
      const row = map.get(herb.name) ?? { name: herb.name, origin: herb.origin, part: herb.part, batches: 0, kg: 0 };
      row.batches += 1;
      row.kg += herb.feedKg;
      map.set(herb.name, row);
    });
    return Array.from(map.values()).sort((a, b) => b.kg - a.kg);
  }, [visible]);

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ origin: '植物', part: '根', feedKg: 50, receivedAt: dayjs() } as unknown as HerbFormValues);
    setOpen(true);
  };

  const openEdit = (record: HerbMaterial) => {
    setEditing(record);
    form.setFieldsValue({ ...record, receivedAt: dayjs(record.receivedAt) } as unknown as HerbFormValues);
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    const payload = {
      name: values.name,
      origin: values.origin,
      part: values.part,
      batchNo: values.batchNo,
      feedKg: values.feedKg,
      receivedAt: values.receivedAt.toISOString(),
      remark: values.remark,
    };
    if (editing) {
      await updateHerb(editing.id, payload);
      message.success(`已更新药材 ${payload.name}`);
    } else {
      await addHerb(payload);
      message.success(`已登记药材 ${payload.name}`);
    }
    setOpen(false);
  };

  const columns: TableColumnsType<HerbMaterial> = [
    { title: '药材名', dataIndex: 'name', width: 110, render: (v: string) => <Text strong>{v}</Text> },
    { title: '基原', dataIndex: 'origin', width: 80, render: (v: string) => <Tag color="green">{v}</Tag> },
    { title: '药用部位', dataIndex: 'part', width: 90 },
    { title: '批次号', dataIndex: 'batchNo', width: 120 },
    { title: '投料量(kg)', dataIndex: 'feedKg', width: 110, align: 'right' },
    { title: '入库时间', dataIndex: 'receivedAt', width: 120, render: (v: string) => formatDate(v) },
    { title: '备注', dataIndex: 'remark', ellipsis: true, render: (v?: string) => v ?? '-' },
    {
      title: '操作',
      width: 140,
      fixed: 'right',
      render: (_, record) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm title={`确认删除 ${record.name}（${record.batchNo}）？`} onConfirm={() => removeHerb(record.id).then(() => message.success('已删除'))}>
            <Button size="small" type="link" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ];

  return (
    <div>
      <Title level={3} style={{ marginBottom: 4 }}>
        药材与批次台账
      </Title>
      <Paragraph type="secondary">按基原与药用部位筛选，按药材名分组回显批次数与待炮制投料量。</Paragraph>

      <Space style={{ marginBottom: 12 }}>
        <Button type="primary" onClick={openCreate}>
          登记药材批次
        </Button>
      </Space>

      <FilterBar
        fields={[
          { key: 'origin', label: '基原', options: HERB_ORIGINS, width: 110 },
          { key: 'part', label: '药用部位', options: HERB_PARTS, width: 110 },
        ]}
        resultCount={visible.length}
        totalCount={herbs.length}
        keywordPlaceholder="搜索药材名 / 批号 / 备注"
      />

      {visible.length === 0 ? (
        <EmptyPanel
          description="没有符合条件的药材批次"
          actionText="重置筛选条件"
          onAction={filter.reset}
        >
          <div style={{ marginTop: 8 }}>
            <Button type="link" onClick={openCreate}>
              或直接登记一条新批次
            </Button>
          </div>
        </EmptyPanel>
      ) : (
        <>
          <Card size="small" title="按药材分组汇总" style={{ marginBottom: 16 }}>
            <Table
              rowKey="name"
              size="small"
              pagination={false}
              dataSource={summary}
              columns={[
                { title: '药材名', dataIndex: 'name', width: 120 },
                { title: '基原', dataIndex: 'origin', width: 80 },
                { title: '药用部位', dataIndex: 'part', width: 90 },
                { title: '批次数', dataIndex: 'batches', width: 90, align: 'right' },
                { title: '待炮制量(kg)', dataIndex: 'kg', width: 130, align: 'right', render: (v: number) => v.toFixed(1) },
              ]}
            />
          </Card>
          <Table rowKey="id" size="small" columns={columns} dataSource={visible} pagination={{ pageSize: 8 }} scroll={{ x: 1000 }} />
        </>
      )}

      <Modal
        open={open}
        title={editing ? `编辑药材批次 · ${editing.batchNo}` : '登记药材批次'}
        onCancel={() => setOpen(false)}
        onOk={submit}
        okText="保存"
        cancelText="取消"
        width={560}
      >
        <Form form={form} layout="vertical">
          <Form.Item name="name" label="药材名" rules={[{ required: true, message: '请输入药材名' }]}>
            <Input placeholder="如：白术" maxLength={20} />
          </Form.Item>
          <Form.Item name="origin" label="基原" rules={[{ required: true, message: '请选择基原' }]}>
            <Select options={HERB_ORIGINS.map((v) => ({ label: v, value: v }))} />
          </Form.Item>
          <Form.Item name="part" label="药用部位" rules={[{ required: true, message: '请选择药用部位' }]}>
            <Select options={HERB_PARTS.map((v) => ({ label: v, value: v }))} />
          </Form.Item>
          <Form.Item name="batchNo" label="批次号" rules={[{ required: true, message: '请输入批次号' }]}>
            <Input placeholder="如：BT-2401" maxLength={24} />
          </Form.Item>
          <Form.Item name="feedKg" label="投料量(kg)" rules={[{ required: true, message: '请输入投料量' }]}>
            <InputNumber min={0} step={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="receivedAt" label="入库时间" rules={[{ required: true, message: '请选择入库时间' }]}>
            <DatePicker style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="remark" label="备注">
            <Input.TextArea rows={2} maxLength={60} placeholder="产地、等级等" />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}
