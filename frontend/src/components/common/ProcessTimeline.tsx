import { Empty, Tag, Timeline, Typography } from 'antd';
import type { HerbMaterial } from '../../types/herb-material';
import type { ProcessingMethod } from '../../types/processing-method';
import type { ProcessBatch, ProcessDegree } from '../../types/process-batch';
import { formatDate } from '../../utils/degree';
import { batchHerbName, batchMethodName } from '../../utils/sync';

const { Text } = Typography;

export interface ProcessTimelineProps {
  batches: ProcessBatch[];
  herbs: HerbMaterial[];
  methods: ProcessingMethod[];
  limit?: number;
}

const DEGREE_COLOR: Record<ProcessDegree, string> = {
  不及: 'orange',
  适中: 'green',
  太过: 'red',
};

/** 炮制工序时间线（首页复用），展示最近批次的方法、火候与得率；锁定批次按锁定快照展示 */
export default function ProcessTimeline({ batches, herbs, methods, limit = 6 }: ProcessTimelineProps) {
  const rows = batches.slice(0, limit);
  if (rows.length === 0) {
    return <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无炮制工序记录" />;
  }

  return (
    <Timeline
      items={rows.map((batch) => {
        return {
          color: batch.degree === '适中' ? 'green' : batch.degree === '太过' ? 'red' : 'orange',
          children: (
            <div>
              <Text strong>{batch.batchNo}</Text>
              <Tag style={{ marginLeft: 8 }} color={DEGREE_COLOR[batch.degree]}>
                {batch.degree}
              </Tag>
              {batch.locked ? <Tag color="blue">已锁定</Tag> : <Tag>待判定</Tag>}
              <div style={{ fontSize: 12, color: '#6b7a70' }}>
                {batchHerbName(batch, herbs)} · {batchMethodName(batch, methods)} · {batch.fireLevel} ·{' '}
                {formatDate(batch.startedAt)} · 得率 {batch.yieldRate}% · 操作人 {batch.operator}
              </div>
            </div>
          ),
        };
      })}
    />
  );
}
