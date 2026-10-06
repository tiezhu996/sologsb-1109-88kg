import { useRef, useState } from 'react';
import { Alert, App as AntApp, Button, Modal, Progress, Space, Steps, Tag, Typography } from 'antd';
import { FileSearchOutlined, CloudUploadOutlined } from '@ant-design/icons';
import { Link } from 'react-router-dom';
import { useSyncStore } from '../stores/syncStore';
import { useHerbStore } from '../stores/herbStore';
import { useMethodStore } from '../stores/methodStore';
import { useBatchStore } from '../stores/batchStore';
import { useSampleStore } from '../stores/sampleStore';
import type { ImportResult } from '../utils/sync';

const { Text, Paragraph } = Typography;

interface ImportBackupModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 导入他机备份：按自然键对账合并，不做整库覆盖。
 * - 旧版本备份先升级再对账；中途中断可续传，同一文件重复导入不多出一份；
 * - 合并失败本机库原样保留，可重试；
 * - 两侧都改过的同名记录转冲突，未决前不入本机（去「对账中心」选择）。
 */
export default function ImportBackupModal({ open, onClose }: ImportBackupModalProps) {
  const { message } = AntApp.useApp();
  const startImport = useSyncStore((s) => s.startImport);
  const resumeImport = useSyncStore((s) => s.resumeImport);
  const resumable = useSyncStore((s) => s.resumable);
  const hydrateHerbs = useHerbStore((s) => s.hydrate);
  const hydrateMethods = useMethodStore((s) => s.hydrate);
  const hydrateBatches = useBatchStore((s) => s.hydrate);
  const hydrateSamples = useSampleStore((s) => s.hydrate);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);

  const rehydrateAll = async () => {
    await Promise.all([hydrateHerbs(), hydrateMethods(), hydrateBatches(), hydrateSamples()]);
  };

  const handleFile = async (file: File) => {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const text = await file.text();
      const importResult = await startImport(text, file.name);
      setResult(importResult);
      if (importResult.outcome === 'failed') {
        setError(importResult.session.error ?? '合并失败，本机库未改动，可重试或续传');
      } else {
        await rehydrateAll();
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleResume = async () => {
    if (!resumable) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const importResult = await resumeImport(resumable.id);
      setResult(importResult);
      if (importResult.outcome === 'failed') {
        setError(importResult.session.error ?? '续传失败，本机库未改动');
      } else {
        await rehydrateAll();
        message.success('已从中断点继续完成导入');
      }
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const reset = () => {
    setResult(null);
    setError(null);
  };

  return (
    <Modal
      open={open}
      title="导入他机备份（对账合并，不覆盖本机）"
      onCancel={() => {
        reset();
        onClose();
      }}
      footer={null}
      width={620}
    >
      <Paragraph type="secondary" style={{ marginBottom: 12 }}>
        备份包与本机库按 <Text strong>药材名+批号 / 炮制方法 / 生产批号 / 留样编号</Text> 对账：仅并入本机没有或本机未改的记录；炮制批次一经锁定以锁定版本为准；同名记录两侧都改时转人工选择，未决前不入本机。
      </Paragraph>

      <input
        ref={fileInputRef}
        type="file"
        accept="application/json,.json"
        style={{ display: 'none' }}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
        }}
      />

      {resumable && !result ? (
        <Alert
          style={{ marginBottom: 12 }}
          type="warning"
          showIcon
          message={`检测到未完成的导入：${resumable.fileName}`}
          description={
            <Space direction="vertical" size={4}>
              <Text style={{ fontSize: 12 }}>
                已暂存 {resumable.stagedRows}/{resumable.totalRows} 行
                {resumable.status === 'failed' ? `；上次失败原因：${resumable.error ?? '未知'}` : '；可从中断点续传'}
              </Text>
              <Button size="small" type="primary" loading={busy} onClick={handleResume}>
                {resumable.status === 'failed' ? '失败重试（本机库未改动）' : '断点续传'}
              </Button>
            </Space>
          }
        />
      ) : null}

      <Space wrap>
        <Button
          icon={<FileSearchOutlined />}
          type="primary"
          loading={busy}
          onClick={() => fileInputRef.current?.click()}
        >
          选择备份 JSON 文件
        </Button>
        {result ? (
          <Button
            onClick={() => {
              reset();
              onClose();
            }}
          >
            关闭
          </Button>
        ) : null}
      </Space>

      {busy ? (
        <div style={{ marginTop: 16 }}>
          <Steps size="small" current={1} items={[{ title: '升级备份' }, { title: '暂存续传' }, { title: '对账合并' }]} />
          <Progress percent={100} status="active" showInfo={false} style={{ marginTop: 8 }} />
          <Text type="secondary">大文件按分块写入暂存区，中断后再次选择同一文件即可续传，不会重复并入。</Text>
        </div>
      ) : null}

      {error ? (
        <Alert style={{ marginTop: 16 }} type="error" showIcon icon={<CloudUploadOutlined />} message="导入未完成" description={error} />
      ) : null}

      {result ? <ResultPanel result={result} /> : null}
    </Modal>
  );
}

function ResultPanel({ result }: { result: ImportResult }) {
  const { outcome, counts, session, pending = 0 } = result;

  if (outcome === 'duplicate') {
    return (
      <Alert
        style={{ marginTop: 16 }}
        type="info"
        showIcon
        message="该备份已导入过"
        description="按文件指纹识别为同一份备份，已跳过合并，本机数据没有多出一份。"
      />
    );
  }

  if (outcome === 'conflicts') {
    return (
      <Alert
        style={{ marginTop: 16 }}
        type="warning"
        showIcon
        message={`对账完成，${pending} 条同名冲突待选择`}
        description={
          <Space direction="vertical" size={4}>
            {counts ? (
              <Text style={{ fontSize: 12 }}>
                新并入 {counts.added} 条、自动更新 {counts.updated} 条、一致 {counts.unchanged} 条；
                {counts.blocked > 0 ? `另有 ${counts.blocked} 条批次/留样待父记录裁决后续传。` : ''}
              </Text>
            ) : (
              <Text style={{ fontSize: 12 }}>该导入已有未决冲突，冲突记录未决前不入本机。</Text>
            )}
            <Link to="/conflicts">
              <Button size="small" type="primary">
                去对账中心处理冲突
              </Button>
            </Link>
          </Space>
        }
      />
    );
  }

  if (outcome === 'merged' && counts) {
    return (
      <Alert
        style={{ marginTop: 16 }}
        type="success"
        showIcon
        message={result.resumed ? '已从中断点续传并完成对账合并' : '对账合并完成'}
        description={
          <Space size={[8, 4]} wrap>
            <Tag color="green">新并入 {counts.added}</Tag>
            <Tag color="blue">自动更新 {counts.updated}</Tag>
            <Tag>两边一致 {counts.unchanged}</Tag>
            {counts.blocked > 0 ? <Tag color="orange">待续传 {counts.blocked}</Tag> : null}
            <Text type="secondary" style={{ fontSize: 12 }}>
              来源：{session.fileName}
            </Text>
          </Space>
        }
      />
    );
  }

  return null;
}
