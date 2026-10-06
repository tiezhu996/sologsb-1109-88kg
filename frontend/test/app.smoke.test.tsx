// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { App as AntApp } from 'antd';
import App from '../src/App';

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <AntApp>
        <App />
      </AntApp>
    </MemoryRouter>,
  );
}

describe('应用外壳渲染冒烟', () => {
  it('首屏装载本地数据并渲染首页、导入/导出入口', async () => {
    renderApp();
    await waitFor(
      () => {
        expect(screen.getByText('中草药炮制工序记录台')).toBeInTheDocument();
      },
      { timeout: 5000 },
    );
    expect(screen.getByRole('button', { name: /导入备份/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /导出备份/ })).toBeInTheDocument();
    expect(screen.getByText('对账中心')).toBeInTheDocument();
    // 示例数据已建立对账基线：默认无未决冲突
    await waitFor(() => {
      expect(screen.queryByText(/条同名冲突待选择/)).not.toBeInTheDocument();
    });
  });
});
