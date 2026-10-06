import { useEffect, useState } from 'react';
import { Layout, Menu, Spin, Typography, App as AntApp, Badge, Button, Space } from 'antd';
import {
  ExperimentOutlined,
  FireOutlined,
  InboxOutlined,
  ProfileOutlined,
  DashboardOutlined,
  DownloadOutlined,
  UploadOutlined,
  SafetyCertificateOutlined,
} from '@ant-design/icons';
import { Link, Outlet, useLocation } from 'react-router-dom';
import { seedIfEmpty } from './utils/seed';
import { useHerbStore } from './stores/herbStore';
import { useMethodStore } from './stores/methodStore';
import { useBatchStore } from './stores/batchStore';
import { useSampleStore } from './stores/sampleStore';
import { useSyncStore } from './stores/syncStore';
import { downloadText, exportBackupJson } from './utils/export';
import ImportBackupModal from './components/ImportBackupModal';

const { Header, Sider, Content, Footer } = Layout;
const { Title, Text } = Typography;

/** 应用外壳：左侧导航 + 顶部导入/导出备份，负责一次性的本地数据装载 */
export default function App() {
  const { message } = AntApp.useApp();
  const [ready, setReady] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const hydrateHerbs = useHerbStore((s) => s.hydrate);
  const hydrateMethods = useMethodStore((s) => s.hydrate);
  const hydrateBatches = useBatchStore((s) => s.hydrate);
  const hydrateSamples = useSampleStore((s) => s.hydrate);
  const hydrateSync = useSyncStore((s) => s.hydrate);
  const pendingConflicts = useSyncStore((s) => s.conflicts.filter((c) => c.status === 'pending').length);
  const location = useLocation();

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        await seedIfEmpty();
        await Promise.all([hydrateHerbs(), hydrateMethods(), hydrateBatches(), hydrateSamples(), hydrateSync()]);
      } catch (error) {
        message.error(`本地数据装载失败：${(error as Error).message}`);
      } finally {
        if (alive) {
          setReady(true);
        }
      }
    })();
    return () => {
      alive = false;
    };
  }, [hydrateHerbs, hydrateMethods, hydrateBatches, hydrateSamples, hydrateSync, message]);

  const selectedKey = (() => {
    const keys = ['/conflicts', '/herbs', '/methods', '/batches', '/samples'];
    return keys.find((key) => location.pathname.startsWith(key)) ?? '/';
  })();

  const handleExport = async () => {
    const json = await exportBackupJson();
    downloadText(`gbherbprocess-backup-${new Date().toISOString().slice(0, 10)}.json`, json);
    message.success('已导出 IndexedDB 全量 JSON 备份');
  };

  const menuItems = [
    { key: '/', icon: <DashboardOutlined />, label: <Link to="/">首页总览</Link> },
    { key: '/herbs', icon: <ExperimentOutlined />, label: <Link to="/herbs">药材台账</Link> },
    { key: '/methods', icon: <FireOutlined />, label: <Link to="/methods">炮制方法</Link> },
    { key: '/batches', icon: <ProfileOutlined />, label: <Link to="/batches">工序记录台</Link> },
    { key: '/samples', icon: <InboxOutlined />, label: <Link to="/samples">留样台账</Link> },
    {
      key: '/conflicts',
      icon: <SafetyCertificateOutlined />,
      label: (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <Link to="/conflicts">对账中心</Link>
          {pendingConflicts > 0 ? <Badge count={pendingConflicts} size="small" /> : null}
        </span>
      ),
    },
  ];

  return (
    <Layout style={{ minHeight: '100vh' }}>
      <Sider breakpoint="lg" collapsedWidth="0" width={208} style={{ background: '#1f4d2e' }}>
        <div style={{ padding: '16px 16px 8px' }}>
          <Title level={5} style={{ color: '#fff', margin: 0 }}>
            炮制工序记录台
          </Title>
          <Text style={{ color: '#a9c9b2', fontSize: 12 }}>gbherbprocess · 纯前端本地存储</Text>
        </div>
        <Menu theme="dark" mode="inline" selectedKeys={[selectedKey]} items={menuItems} style={{ background: 'transparent' }} />
      </Sider>
      <Layout>
        <Header style={{ background: '#fff', padding: '0 16px', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <Text strong>中草药炮制工序记录台</Text>
          <Space>
            <Button icon={<UploadOutlined />} onClick={() => setImportOpen(true)}>
              导入备份
              {pendingConflicts > 0 ? <Badge count={pendingConflicts} size="small" offset={[4, -2]} /> : null}
            </Button>
            <Button icon={<DownloadOutlined />} onClick={handleExport}>
              导出备份
            </Button>
          </Space>
        </Header>
        <Content style={{ padding: 16 }}>
          {ready ? (
            <Outlet />
          ) : (
            <div style={{ display: 'flex', justifyContent: 'center', padding: '80px 0' }}>
              <Spin size="large" />
            </div>
          )}
        </Content>
        <Footer style={{ textAlign: 'center', color: '#8c9a90', padding: '12px 0' }}>
          数据保存在浏览器 IndexedDB（gbherbprocess-db），不依赖后端服务
        </Footer>
      </Layout>

      <ImportBackupModal open={importOpen} onClose={() => setImportOpen(false)} />
    </Layout>
  );
}
