import { Badge, Space, Tooltip, Typography } from 'antd';
import { CABINETS, type SampleExpiry } from '../../types/retain-sample';

const { Text } = Typography;

export interface CabinetGridProps {
  /** 到期派生清单（含占用与到期状态） */
  expiryList: SampleExpiry[];
  selected?: string;
  onSelect?: (cabinet: string) => void;
}

const STATE_COLOR: Record<SampleExpiry['state'], string> = {
  已到期: '#cf1322',
  临期: '#d48806',
  观察中: '#237804',
};

/** 留样柜位网格，显示占用与到期状态，被留样台账消费 */
export default function CabinetGrid({ expiryList, selected, onSelect }: CabinetGridProps) {
  const byCabinet = new Map<string, SampleExpiry[]>();
  expiryList.forEach((item) => {
    const list = byCabinet.get(item.sample.cabinet) ?? [];
    list.push(item);
    byCabinet.set(item.sample.cabinet, list);
  });

  const used = byCabinet.size;
  const total = CABINETS.length;

  return (
    <div>
      <Space size={12} style={{ marginBottom: 8 }} wrap>
        <Text type="secondary">
          柜位占用 {used} / {total}
        </Text>
        <Badge color={STATE_COLOR['观察中']} text="观察中" />
        <Badge color={STATE_COLOR['临期']} text="30 天内到期" />
        <Badge color={STATE_COLOR['已到期']} text="已到期" />
      </Space>
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(64px, 1fr))',
          gap: 6,
        }}
      >
        {CABINETS.map((cabinet) => {
          const items = byCabinet.get(cabinet) ?? [];
          const worst = items.reduce<SampleExpiry | undefined>((acc, item) => {
            if (!acc) return item;
            const rank = { 已到期: 3, 临期: 2, 观察中: 1 } as const;
            return rank[item.state] > rank[acc.state] ? item : acc;
          }, undefined);
          const bg = worst ? STATE_COLOR[worst.state] : '#f0f3f0';
          const fg = worst ? '#fff' : '#8c9a90';
          const active = selected === cabinet;
          return (
            <Tooltip
              key={cabinet}
              title={
                items.length
                  ? items.map((i) => `${i.sample.sampleNo} · ${i.state} · 剩 ${i.daysLeft} 天`).join('；')
                  : '空柜位'
              }
            >
              <button
                type="button"
                onClick={() => onSelect?.(cabinet)}
                style={{
                  cursor: 'pointer',
                  border: active ? '2px solid #1f4d2e' : '1px solid #dbe6dd',
                  borderRadius: 6,
                  background: bg,
                  color: fg,
                  padding: '6px 2px',
                  fontSize: 12,
                  lineHeight: 1.3,
                }}
              >
                <div style={{ fontWeight: 600 }}>{cabinet}</div>
                <div>{items.length ? `${items.length} 份` : '空'}</div>
              </button>
            </Tooltip>
          );
        })}
      </div>
    </div>
  );
}
