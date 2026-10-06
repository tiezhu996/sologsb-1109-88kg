import { useMemo, useState } from 'react';
import { App as AntApp, Button, Card, Col, Form, Input, InputNumber, Modal, Popconfirm, Row, Select, Space, Table, Tag, Typography } from 'antd';
import type { TableColumnsType } from 'antd';
import FireLevelTag from '../components/common/FireLevelTag';
import RatioCalculator from '../components/common/RatioCalculator';
import { useMethodStore } from '../stores/methodStore';
import {
  AUXILIARIES,
  CRITERION_DIMENSIONS,
  FIRE_LEVELS,
  METHOD_NAMES,
  type Auxiliary,
  type CriterionDimension,
  type FireLevel,
  type MethodName,
  type ProcessingMethod,
} from '../types/processing-method';

const { Title, Paragraph, Text } = Typography;

interface MethodFormValues {
  name: MethodName;
  auxiliary: Auxiliary;
  auxRatio: number;
  fireLevel: FireLevel;
  tempMin: number;
  tempMax: number;
  duration: number;
  criterion: string;
  criterionDimension: CriterionDimension;
  applicable: string;
}

/** 炮制方法与辅料比例：按投料量折算用量并可复制派生 */
export default function MethodList() {
  const { message } = AntApp.useApp();
  const methods = useMethodStore((s) => s.methods);
  const addMethod = useMethodStore((s) => s.addMethod);
  const updateMethod = useMethodStore((s) => s.updateMethod);
  const removeMethod = useMethodStore((s) => s.removeMethod);
  const deriveMethod = useMethodStore((s) => s.deriveMethod);

  const [form] = Form.useForm<MethodFormValues>();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<ProcessingMethod | null>(null);

  const [deriveOpen, setDeriveOpen] = useState(false);
  const [deriveSource, setDeriveSource] = useState<ProcessingMethod | null>(null);
  const [deriveForm] = Form.useForm<{ name: MethodName; auxRatio: number }>();

  const [calcMethodId, setCalcMethodId] = useState<string>(methods[0]?.id ?? '');
  const [calcFeedKg, setCalcFeedKg] = useState<number>(100);
  const [calcAuxUsedKg, setCalcAuxUsedKg] = useState<number>(0);
  const [calcOutputKg, setCalcOutputKg] = useState<number>(94);

  const calcMethod = useMemo(
    () => methods.find((m) => m.id === calcMethodId) ?? methods[0],
    [methods, calcMethodId],
  );

  const openCreate = () => {
    setEditing(null);
    form.resetFields();
    form.setFieldsValue({ name: '清炒', auxiliary: '无', auxRatio: 0, fireLevel: '文火', tempMin: 90, tempMax: 120, duration: 12, criterionDimension: '色泽' } as unknown as MethodFormValues);
    setOpen(true);
  };

  const openEdit = (record: ProcessingMethod) => {
    setEditing(record);
    form.setFieldsValue({
      name: record.name,
      auxiliary: record.auxiliary,
      auxRatio: record.auxRatio,
      fireLevel: record.fireLevel,
      tempMin: record.tempRange[0],
      tempMax: record.tempRange[1],
      duration: record.duration,
      criterion: record.criterion,
      criterionDimension: record.criterionDimension,
      applicable: record.applicable,
    });
    setOpen(true);
  };

  const submit = async () => {
    const values = await form.validateFields();
    if (values.tempMin > values.tempMax) {
      message.error('温度下限不能高于上限');
      return;
    }
    const payload = {
      name: values.name,
      auxiliary: values.auxiliary,
      auxRatio: values.auxRatio,
      fireLevel: values.fireLevel,
      tempRange: [values.tempMin, values.tempMax] as [number, number],
      duration: values.duration,
      criterion: values.criterion,
      criterionDimension: values.criterionDimension,
      applicable: values.applicable,
    };
    if (editing) {
      await updateMethod(editing.id, payload);
      message.success(`已更新方法 ${payload.name}`);
    } else {
      await addMethod(payload);
      message.success(`已新增方法 ${payload.name}`);
    }
    setOpen(false);
  };

  const openDerive = (record: ProcessingMethod) => {
    setDeriveSource(record);
    deriveForm.resetFields();
    deriveForm.setFieldsValue({ name: record.name, auxRatio: record.auxRatio });
    setDeriveOpen(true);
  };

  const submitDerive = async () => {
    if (!deriveSource) return;
    const values = await deriveForm.validateFields();
    const created = await deriveMethod(deriveSource.id, values.name, values.auxRatio);
    if (created) {
      message.success(`已从「${deriveSource.name}」派生新方法（辅料比例 ${values.auxRatio}kg/100kg）`);
      setCalcMethodId(created.id);
    }
    setDeriveOpen(false);
  };

  const columns: TableColumnsType<ProcessingMethod> = [
    {
      title: '方法',
      dataIndex: 'name',
      width: 90,
      render: (v: string, record) => (
        <Space size={4}>
          <Text strong>{v}</Text>
          {record.derivedFrom ? <Tag color="blue">派生</Tag> : null}
        </Space>
      ),
    },
    { title: '辅料', dataIndex: 'auxiliary', width: 80 },
    { title: '每100kg用量(kg)', dataIndex: 'auxRatio', width: 140, align: 'right' },
    {
      title: '火候',
      dataIndex: 'fireLevel',
      width: 190,
      render: (v: FireLevel, record) => <FireLevelTag level={v} tempRange={record.tempRange} duration={record.duration} />,
    },
    { title: '判断标准', dataIndex: 'criterion', ellipsis: true, render: (v: string, record) => <span>{v}<Tag style={{ marginLeft: 6 }}>{record.criterionDimension}</Tag></span> },
    { title: '适用药材', dataIndex: 'applicable', width: 160, ellipsis: true },
    {
      title: '操作',
      width: 200,
      fixed: 'right',
      render: (_, record) => (
        <Space size={4}>
          <Button size="small" type="link" onClick={() => { setCalcMethodId(record.id); setCalcAuxUsedKg(Number(((calcFeedKg * record.auxRatio) / 100).toFixed(2))); }}>
            折算
          </Button>
          <Button size="small" type="link" onClick={() => openDerive(record)}>
            复制派生
          </Button>
          <Button size="small" type="link" onClick={() => openEdit(record)}>
            编辑
          </Button>
          <Popconfirm title={`确认删除方法「${record.name}」？`} onConfirm={() => removeMethod(record.id).then(() => message.success('已删除'))}>
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
        炮制方法与辅料比例
      </Title>
      <Paragraph type="secondary">选择方法即带出辅料比例、火候与判断标准；支持按投料量折算辅料用量与反向推算。</Paragraph>

      <Row gutter={[16, 16]} style={{ marginBottom: 16 }}>
        <Col xs={24} lg={14}>
          <Card
            size="small"
            title="辅料折算台"
            extra={<Text type="secondary">反向推算：输入现有辅料量可算出最大投料量</Text>}
          >
            <Space direction="vertical" size={10} style={{ width: '100%' }}>
              <Space wrap>
                <span style={{ color: '#6b7a70' }}>炮制方法</span>
                <Select
                  style={{ width: 180 }}
                  value={calcMethod?.id}
                  onChange={(value: string) => {
                    setCalcMethodId(value);
                    const target = methods.find((m) => m.id === value);
                    if (target) {
                      setCalcAuxUsedKg(Number(((calcFeedKg * target.auxRatio) / 100).toFixed(2)));
                      setCalcOutputKg(Number(((calcFeedKg * (target.name === '蜜炙' ? 1.08 : 0.94))).toFixed(2)));
                    }
                  }}
                  options={methods.map((m) => ({ label: `${m.name} · ${m.auxiliary}`, value: m.id }))}
                />
                {calcMethod ? <FireLevelTag level={calcMethod.fireLevel} tempRange={calcMethod.tempRange} duration={calcMethod.duration} /> : null}
              </Space>
              {calcMethod ? (
                <>
                  <Text type="secondary">判断标准：{calcMethod.criterion}（{calcMethod.criterionDimension}）</Text>
                  <RatioCalculator
                    auxRatio={calcMethod.auxRatio}
                    auxiliary={calcMethod.auxiliary}
                    feedKg={calcFeedKg}
                    auxUsedKg={calcAuxUsedKg}
                    outputKg={calcOutputKg}
                    onChange={(patch) => {
                      if (patch.feedKg !== undefined) {
                        setCalcFeedKg(patch.feedKg);
                        setCalcAuxUsedKg(Number(((patch.feedKg * calcMethod.auxRatio) / 100).toFixed(2)));
                        setCalcOutputKg(Number((patch.feedKg * (calcMethod.name === '蜜炙' ? 1.08 : 0.94)).toFixed(2)));
                      }
                      if (patch.auxUsedKg !== undefined) {
                        setCalcAuxUsedKg(patch.auxUsedKg);
                      }
                    }}
                  />
                  <Space wrap>
                    <span style={{ color: '#6b7a70' }}>炮制后重量</span>
                    <InputNumber min={0} step={0.5} value={calcOutputKg} addonAfter="kg" style={{ width: 150 }} onChange={(v) => setCalcOutputKg(Number(v) || 0)} />
                  </Space>
                </>
              ) : (
                <Text type="secondary">暂无炮制方法，请先新增</Text>
              )}
            </Space>
          </Card>
        </Col>
        <Col xs={24} lg={10}>
          <Card size="small" title="方法一览" extra={<Button size="small" type="primary" onClick={openCreate}>新增方法</Button>}>
            <Space direction="vertical" size={6} style={{ width: '100%' }}>
              {methods.slice(0, 8).map((m) => (
                <div key={m.id} style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                  <span>
                    <Tag color="green">{m.name}</Tag>
                    {m.auxiliary !== '无' ? `${m.auxiliary} ${m.auxRatio}kg/100kg` : '不辅以辅料'}
                  </span>
                  <Text type="secondary">{m.tempRange[0]}~{m.tempRange[1]}℃ · {m.duration}min</Text>
                </div>
              ))}
            </Space>
          </Card>
        </Col>
      </Row>

      <Table rowKey="id" size="small" columns={columns} dataSource={methods} pagination={{ pageSize: 10 }} scroll={{ x: 1200 }} />

      <Modal open={open} title={editing ? `编辑炮制方法 · ${editing.name}` : '新增炮制方法'} onCancel={() => setOpen(false)} onOk={submit} okText="保存" cancelText="取消" width={640}>
        <Form form={form} layout="vertical">
          <Row gutter={12}>
            <Col span={12}>
              <Form.Item name="name" label="方法名" rules={[{ required: true, message: '请选择方法名' }]}>
                <Select options={METHOD_NAMES.map((v) => ({ label: v, value: v }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="auxiliary" label="辅料" rules={[{ required: true, message: '请选择辅料' }]}>
                <Select options={AUXILIARIES.map((v) => ({ label: v, value: v }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="auxRatio" label="每100kg药材用量(kg)" rules={[{ required: true, message: '请输入用量' }]}>
                <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="fireLevel" label="火力" rules={[{ required: true, message: '请选择火力' }]}>
                <Select options={FIRE_LEVELS.map((v) => ({ label: v, value: v }))} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="tempMin" label="温度下限(℃)" rules={[{ required: true, message: '请输入温度下限' }]}>
                <InputNumber min={0} max={800} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="tempMax" label="温度上限(℃)" rules={[{ required: true, message: '请输入温度上限' }]}>
                <InputNumber min={0} max={800} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="duration" label="时间(min)" rules={[{ required: true, message: '请输入时间' }]}>
                <InputNumber min={0} style={{ width: '100%' }} />
              </Form.Item>
            </Col>
            <Col span={12}>
              <Form.Item name="criterionDimension" label="判断标准侧重" rules={[{ required: true, message: '请选择判断维度' }]}>
                <Select options={CRITERION_DIMENSIONS.map((v) => ({ label: v, value: v }))} />
              </Form.Item>
            </Col>
          </Row>
          <Form.Item name="criterion" label="判断标准" rules={[{ required: true, message: '请输入判断标准' }]}>
            <Input placeholder="如：表面微黄、气香、断面颜色加深" maxLength={60} />
          </Form.Item>
          <Form.Item name="applicable" label="适用药材" rules={[{ required: true, message: '请输入适用药材' }]}>
            <Input placeholder="如：白术、黄芪" maxLength={60} />
          </Form.Item>
        </Form>
      </Modal>

      <Modal open={deriveOpen} title={`复制派生 · 源方法 ${deriveSource?.name ?? ''}`} onCancel={() => setDeriveOpen(false)} onOk={submitDerive} okText="派生新方法" cancelText="取消">
        <Form form={deriveForm} layout="vertical">
          <Form.Item name="name" label="新方法名" rules={[{ required: true, message: '请选择方法名' }]}>
            <Select options={METHOD_NAMES.map((v) => ({ label: v, value: v }))} />
          </Form.Item>
          <Form.Item name="auxRatio" label="辅料比例(每100kg用量 kg)" rules={[{ required: true, message: '请输入辅料比例' }]}>
            <InputNumber min={0} step={0.5} style={{ width: '100%' }} />
          </Form.Item>
          <Text type="secondary">派生会复制火候、温度区间与判断标准，仅辅料比例可按需调整。</Text>
        </Form>
      </Modal>
    </div>
  );
}
