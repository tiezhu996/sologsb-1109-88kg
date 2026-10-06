import { useEffect, useState } from 'react';
import { Alert, Button, Modal, Progress, Space, Typography, Upload } from 'antd';
import { InboxOutlined, MergeCellsOutlined } from '@ant-design/icons';
import { useNavigate } from 'react-router-dom';
import { App as AntApp } from 'antd';
import {
  applyMerge,
  loadImportSession,
  previewMerge,
  type ImportSession,
  type MergePreview,
  type MergeSummary,
} from '../utils/merge';
import { useHerbStore } from '../stores/herbStore';
import { useMethodStore } from '../stores/methodStore';
import { useBatchStore } from '../stores/batchStore';
import { useSampleStore } from '../stores/sampleStore';
import { useConflictStore } from '../stores/conflictStore';

const { Text } = Typography;

type Step = 'pick' | 'preview' | 'applying' | 'done' | 'failed';

export interface ImportMergeModalProps {
  open: boolean;
  onClose: () => void;
}

/**
 * 备份导入（对账合并）：选文件 → 预览对账结果 → 分块合并（中断可续传）。
 * 不再整库清库恢复；冲突未处理前备份版本不写入本机。
 */
export default function ImportMergeModal({ open, onClose }: ImportMergeModalProps) {
  const { message } = AntApp.useApp();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>('pick');
  const [fileText, setFileText] = useState('');
  const [fileName, setFileName] = useState('');
  const [preview, setPreview] = useState<MergePreview | undefined>();
  const [summary, setSummary] = useState<MergeSummary | undefined>();
  const [error, setError] = useState('');
  const [progress, setProgress] = useState<{ done: number; total: number }>({ done: 0, total: 0 });
  const [lastSession, setLastSession] = useState<ImportSession | undefined>();

  const hydrateAll = async () => {
    await Promise.all([
      useHerbStore.getState().hydrate(),
      useMethodStore.getState().hydrate(),
      useBatchStore.getState().hydrate(),
      useSampleStore.getState().hydrate(),
      useConflictStore.getState().hydrate(),
    ]);
  };

  useEffect(() => {
    if (open) {
      setStep('pick');
      setPreview(undefined);
      setSummary(undefined);
      setError('');
      setProgress({ done: 0, total: 0 });
      void loadImportSession().then((session) => {
        if (session && (session.status === 'applying' || session.status === 'failed')) {
          setLastSession(session);
        } else {
          setLastSession(undefined);
        }
      });
    }
  }, [open]);

  const handleFile = async (file: File) => {
    try {
      const text = await file.text();
      const result = await previewMerge(text);
      setFileText(text);
      setFileName(file.name);
      setPreview(result);
      setStep('preview');
    } catch (e) {
      message.error(`备份读取失败：${(e as Error).message}（本机库未改动）`);
    }
  };

  const handleApply = async () => {
    setStep('applying');
    setProgress({ done: 0, total: 0 });
    try {
      const result = await applyMerge(fileText, fileName, (done, total) => setProgress({ done, total }));
      setSummary(result);
      setStep('done');
      await hydrateAll();
    } catch (e) {
      setError((e as Error).message);
      setStep('failed');
      await hydrateAll();
    }
  };

  const stats = preview?.plan.stats;
  const statLine = stats
    ? `新增 ${stats.inserted} 条 · 已一致 ${stats.same} 条 · 本机锁定保留 ${stats.lockedKeep} 条 · 备份锁定覆盖 ${stats.lockedTake} 条 · 待决冲突 ${stats.conflicts} 条`
    : '';

  return (
    <Modal
      title={
        <Space>
          <MergeCellsOutlined />
          导入备份（对账合并）
        </Space>
      }
      open={open}
      onCancel={step === 'applying' ? undefined : onClose}
      footer={null}
      maskClosable={step !== 'applying'}
      destroyOnClose
    >
      {step === 'pick' ? (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Alert
            type="info"
            showIcon
            message="按业务键对账合并，不清空本机库"
            description="按药材名+批号、炮制方法、生产批号、留样编号逐条对账：新记录补入，一致记录跳过；已锁定的炮制批次以锁定版本为准；两边都改过的记录列为冲突，处理前不写入本机。旧版本备份会在导入时自动升级。"
          />
          {lastSession ? (
            <Alert
              type="warning"
              showIcon
              message={`上次导入《${lastSession.fileName}》${lastSession.status === 'failed' ? '失败' : '中断'}（已写入 ${lastSession.appliedKeys.length}/${lastSession.total} 条）`}
              description="重新选择同一备份文件将从断点续传，已写入的记录不会重复。"
            />
          ) : null}
          <Upload.Dragger
            accept=".json,application/json"
            multiple={false}
            showUploadList={false}
            beforeUpload={(file) => {
              void handleFile(file);
              return false;
            }}
          >
            <p className="ant-upload-drag-icon">
              <InboxOutlined />
            </p>
            <p className="ant-upload-text">点击或拖拽备份 JSON 文件到此处</p>
            <p className="ant-upload-hint">仅接受本系统「导出备份」生成的 JSON 文件</p>
          </Upload.Dragger>
        </Space>
      ) : null}

      {step === 'preview' && preview ? (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Text>
            文件 <Text strong>{fileName}</Text>（schema v{preview.payload.sourceVersion}
            {preview.payload.sourceVersion < 3 ? '，导入时将自动升级' : ''}），对账结果：
          </Text>
          <Alert type="info" showIcon message={statLine} />
          {preview.resumeSession ? (
            <Alert
              type="warning"
              showIcon
              message="检测到该文件上次导入未完成"
              description={`已写入 ${preview.resumeSession.appliedKeys.length}/${preview.resumeSession.total} 条，本次将从断点续传，不会重复写入。`}
            />
          ) : null}
          {stats && stats.conflicts > 0 ? (
            <Alert
              type="warning"
              showIcon
              message={`有 ${stats.conflicts} 条记录两边都改过`}
              description="合并后请到「合并冲突」页逐条选择保留本机还是采用备份；处理前备份版本不会写入本机。"
            />
          ) : null}
          <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={() => setStep('pick')}>重新选择</Button>
            <Button type="primary" onClick={() => void handleApply()}>
              {preview.resumeSession ? '续传合并' : '开始合并'}
            </Button>
          </Space>
        </Space>
      ) : null}

      {step === 'applying' ? (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Text>正在分块写入本机库，请勿关闭页面……</Text>
          <Progress
            percent={progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 100}
            status="active"
          />
          <Text type="secondary">
            已写入 {progress.done}/{progress.total} 条；若中断，重新导入同一文件即可续传。
          </Text>
        </Space>
      ) : null}

      {step === 'done' && summary ? (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Alert
            type="success"
            showIcon
            message="合并完成"
            description={`新增 ${summary.stats.inserted} 条 · 已一致跳过 ${summary.stats.same} 条 · 本机锁定保留 ${summary.stats.lockedKeep} 条 · 备份锁定覆盖 ${summary.stats.lockedTake} 条${
              summary.resumed ? ` · 续传前已写入 ${summary.previouslyApplied} 条` : ''
            }`}
          />
          {summary.conflicts > 0 ? (
            <Alert
              type="warning"
              showIcon
              message={`${summary.conflicts} 条冲突待处理`}
              description="同名记录两边都改过，处理前备份版本未写入本机。"
            />
          ) : null}
          <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
            {summary.conflicts > 0 ? (
              <Button
                type="primary"
                onClick={() => {
                  onClose();
                  navigate('/conflicts');
                }}
              >
                前往处理冲突
              </Button>
            ) : null}
            <Button onClick={onClose}>关闭</Button>
          </Space>
        </Space>
      ) : null}

      {step === 'failed' ? (
        <Space direction="vertical" style={{ width: '100%' }} size={12}>
          <Alert
            type="error"
            showIcon
            message="合并失败，本机库保持有效"
            description={`${error}。已写入的进度已保存，点击重试将从断点续传。`}
          />
          <Space style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <Button onClick={onClose}>关闭</Button>
            <Button type="primary" onClick={() => void handleApply()}>
              重试（断点续传）
            </Button>
          </Space>
        </Space>
      ) : null}
    </Modal>
  );
}
