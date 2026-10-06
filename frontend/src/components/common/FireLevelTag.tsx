import { Tag, Tooltip } from 'antd';
import type { FireLevel } from '../../types/processing-method';
import { FIRE_LEVEL_TEMP } from '../../utils/degree';

export interface FireLevelTagProps {
  level: FireLevel;
  /** 该方法的温度区间（℃）；不传则展示火力常用区间 */
  tempRange?: [number, number];
  /** 炮制时间（min） */
  duration?: number;
  /** 是否展示温度区间提示 */
  showHint?: boolean;
}

const COLOR: Record<FireLevel, string> = {
  文火: 'green',
  中火: 'orange',
  武火: 'red',
};

/** 火力与火候标签，含温度区间提示（炮制方法页、工序记录台复用） */
export default function FireLevelTag({ level, tempRange, duration, showHint = true }: FireLevelTagProps) {
  const range = tempRange ?? FIRE_LEVEL_TEMP[level];
  const text = `${range[0]}~${range[1]}℃${duration ? ` · ${duration}min` : ''}`;
  const tag = <Tag color={COLOR[level]}>{level}</Tag>;
  if (!showHint) {
    return tag;
  }
  return (
    <span style={{ whiteSpace: 'nowrap' }}>
      <Tooltip title={`火力标准区间 ${text}`}>{tag}</Tooltip>
      <span style={{ marginLeft: 6, fontSize: 12, color: '#6b7a70' }}>{text}</span>
    </span>
  );
}
