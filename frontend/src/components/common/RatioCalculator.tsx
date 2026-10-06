import { Alert, InputNumber, Space, Typography } from 'antd';
import type { Auxiliary } from '../../types/processing-method';
import { useRatio, needAuxiliary } from '../../hooks/useRatio';

const { Text } = Typography;

export interface RatioCalculatorProps {
  /** 每 100kg 药材辅料用量（kg） */
  auxRatio: number;
  auxiliary: Auxiliary;
  /** 投料量（kg） */
  feedKg: number;
  /** 辅料实际用量（kg） */
  auxUsedKg?: number;
  /** 炮制后重量（kg），用于得率 */
  outputKg?: number;
  /** 数值变化回传，供父级表单同步 */
  onChange?: (patch: { feedKg?: number; auxUsedKg?: number }) => void;
  /** 是否展示反向推算（由辅料用量反推投料量） */
  reverse?: boolean;
  /** 紧凑模式（表格行内使用） */
  compact?: boolean;
}

/**
 * 按投料量折算辅料用量并支持反向推算，被炮制方法页、工序记录台消费。
 */
export default function RatioCalculator({
  auxRatio,
  auxiliary,
  feedKg,
  auxUsedKg,
  outputKg,
  onChange,
  reverse = true,
  compact = false,
}: RatioCalculatorProps) {
  const ratio = useRatio({ auxRatio, feedKg, auxUsedKg, outputKg });
  const needAux = needAuxiliary(auxiliary);
  const deviationWarn = needAux && Math.abs(ratio.deviationPct) > 5;

  const content = (
    <Space direction="vertical" size={compact ? 4 : 8} style={{ width: '100%' }}>
      {!compact ? (
        <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap', fontSize: 13 }}>
          <span>
            <span style={{ color: '#6b7a70' }}>辅料：</span>
            {auxiliary}
          </span>
          <span>
            <span style={{ color: '#6b7a70' }}>辅料比例：</span>
            {ratio.ratioText}
          </span>
        </div>
      ) : null}

      <Space wrap size={8} align="center">
        <span style={{ color: '#6b7a70' }}>投料量</span>
        <InputNumber
          min={0}
          step={1}
          value={feedKg}
          addonAfter="kg"
          style={{ width: 140 }}
          onChange={(value) => onChange?.({ feedKg: Number(value) || 0 })}
        />
        <span style={{ color: '#6b7a70' }}>应投辅料</span>
        <Text strong>{needAux ? `${ratio.auxTargetKg} kg` : '无需辅料'}</Text>
      </Space>

      <Space wrap size={8} align="center">
        <span style={{ color: '#6b7a70' }}>辅料实际</span>
        <InputNumber
          min={0}
          step={0.1}
          value={auxUsedKg}
          addonAfter="kg"
          style={{ width: 140 }}
          disabled={!needAux}
          onChange={(value) => onChange?.({ auxUsedKg: Number(value) || 0 })}
        />
        <span style={{ color: deviationWarn ? '#cf1322' : '#6b7a70' }}>
          偏差 {ratio.deviationKg >= 0 ? '+' : ''}
          {ratio.deviationKg} kg（{ratio.deviationPct}%）
        </span>
      </Space>

      {needAux && deviationWarn ? (
        <Alert
          type="warning"
          showIcon
          message={`辅料用量偏离标准比例 ${ratio.deviationPct}%，请复核称量记录`}
        />
      ) : null}

      {reverse && needAux ? (
        <Space wrap size={8} align="center">
          <span style={{ color: '#6b7a70' }}>反向推算：现有辅料</span>
          <InputNumber
            min={0}
            step={0.5}
            placeholder="辅料量"
            addonAfter="kg"
            style={{ width: 150 }}
            onChange={(value) => {
              const aux = Number(value) || 0;
              if (aux > 0 && auxRatio > 0) {
                onChange?.({ feedKg: ratio.feedKgFromAux(aux) });
              }
            }}
          />
          <Text type="secondary">按比例可炮制最大投料量</Text>
        </Space>
      ) : null}

      {typeof outputKg === 'number' ? (
        <Text type="secondary">
          得率 {ratio.yieldRate()}%（{outputKg}kg / {feedKg}kg）
        </Text>
      ) : null}
    </Space>
  );

  if (compact) {
    return content;
  }

  return <div style={{ background: '#f7faf7', border: '1px solid #e2efe4', borderRadius: 8, padding: 12 }}>{content}</div>;
}
