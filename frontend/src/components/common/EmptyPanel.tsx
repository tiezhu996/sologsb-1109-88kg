import { Button, Empty } from 'antd';
import type { ReactNode } from 'react';

export interface EmptyPanelProps {
  description: string;
  actionText?: string;
  onAction?: () => void;
  children?: ReactNode;
}

/** 空状态面板（药材台账、留样台账复用） */
export default function EmptyPanel({ description, actionText, onAction, children }: EmptyPanelProps) {
  return (
    <div style={{ padding: '32px 16px', background: '#fff', borderRadius: 8, border: '1px dashed #c8d6cb' }}>
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={<span style={{ color: '#6b7a70' }}>{description}</span>}
      >
        {actionText && onAction ? (
          <Button type="primary" onClick={onAction}>
            {actionText}
          </Button>
        ) : null}
        {children}
      </Empty>
    </div>
  );
}
