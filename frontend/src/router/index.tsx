import type { RouteObject } from 'react-router-dom';
import { Button, Result } from 'antd';
import App from '../App';
import ProcessBoard from '../pages/ProcessBoard';
import HerbList from '../pages/HerbList';
import MethodList from '../pages/MethodList';
import BatchBoard from '../pages/BatchBoard';
import SampleLedger from '../pages/SampleLedger';

function NotFound() {
  return (
    <Result
      status="404"
      title="页面不存在"
      subTitle="请从左侧菜单进入炮制工序记录台的各功能页"
      extra={
        <Button type="primary" href="/">
          返回首页
        </Button>
      }
    />
  );
}

/** 全部路由：首页 + 药材台账 / 炮制方法 / 工序记录台 / 留样台账 */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <App />,
    children: [
      { index: true, element: <ProcessBoard /> },
      { path: 'herbs', element: <HerbList /> },
      { path: 'methods', element: <MethodList /> },
      { path: 'batches', element: <BatchBoard /> },
      { path: 'samples', element: <SampleLedger /> },
      { path: '*', element: <NotFound /> },
    ],
  },
];

export default routes;
