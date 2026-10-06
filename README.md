# 中草药炮制工序记录台（gbherbprocess）

面向中药饮片厂炮制班组与质检员：登记药材批次、按炮制方法折算辅料比例与火力时间、逐批判定炮制程度、管理留样观察台账。纯前端单页应用，数据全部保存在浏览器本地，不依赖任何后端服务或外部接口。

## Docker 一键启动

```bash
cp .env.example .env
docker compose up -d --build
```

启动后访问：<http://localhost:21809>

停止并清理：

```bash
docker compose down
```

## 技术栈

| 层次 | 选型 |
| --- | --- |
| 框架 | React 18 + TypeScript |
| 构建 | Vite 6（`npm run build` 含 `tsc --noEmit` 类型检查） |
| UI | Ant Design 5 + @ant-design/icons |
| 路由 | React Router 6（6 条路由） |
| 状态 | Zustand（herbStore / methodStore / batchStore / sampleStore / conflictStore） |
| 存储 | IndexedDB（Dexie，库名 `gbherbprocess-db`） |
| 托管 | nginx:alpine（多阶段构建，SPA try_files + gzip） |

## 本地开发

```bash
cd frontend
npm install
npm run dev      # http://localhost:21809
npm run build    # 类型检查 + 生产构建
```

## 目录结构

```
.
├── docker-compose.yml         # 顶层 name / COMPOSE_PROJECT_NAME 容器名 / 端口映射
├── .env.example               # COMPOSE_PROJECT_NAME、FRONTEND_PORT
├── frontend/
│   ├── Dockerfile             # node:20-alpine 构建 → nginx:alpine 托管
│   ├── nginx.conf             # try_files SPA 回退 + gzip
│   ├── public/favicon.svg
│   └── src/
│       ├── types/             # herb-material / processing-method / process-batch / retain-sample / merge-conflict
│       ├── stores/            # herbStore / methodStore / batchStore / sampleStore / conflictStore
│       ├── components/        # ImportMergeModal（导入对账合并）+ common/ 通用件
│       ├── hooks/             # useHerbFilter / useRatio
│       ├── pages/             # ProcessBoard / HerbList / MethodList / BatchBoard / SampleLedger / ConflictCenter
│       ├── router/index.tsx   # 路由表
│       └── utils/             # db.ts / degree.ts / export.ts / merge.ts / seed.ts / id.ts
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 首页总览 | 待炮制批次、留样到期提示、最近工序时间线、平均得率、待处理合并冲突数 |
| `/herbs` | 药材台账 | 药材与批次登记，按基原/药用部位筛选，按药材分组汇总 |
| `/methods` | 炮制方法 | 辅料比例、火力与判断标准维护，辅料折算台与复制派生 |
| `/batches` | 工序记录台 | 选方法自动带出辅料比例/火候/判断标准，录入火候与得率并判定程度 |
| `/samples` | 留样台账 | 柜位网格、到期提醒、按日期追加观察记录 |
| `/conflicts` | 合并冲突 | 备份与本机两边都改过的同名记录逐条选定，处理结果留痕 |

## 备份导入（对账合并）

顶栏「导入备份」不再整库清库恢复，而是与本机库逐条对账合并（`src/utils/merge.ts`）：

- **业务键对账**：药材按药材名+批号、炮制方法按方法名+辅料+比例、炮制批次按生产批号、留样按留样编号匹配；新记录补入（引用自动重映射到本机 id），内容一致的跳过。
- **锁定批次不改写**：炮制批次一经锁定以锁定版本为准——本机已锁定的批次，备份侧后改的药材/方法/得率一律不得回写；本机未锁定而备份已锁定的，采用备份锁定版本（保留本机 id 覆盖，引用不断链）。
- **冲突待决**：同业务键但两边内容不一致的记录列入「合并冲突」页，逐条选择保留本机或采用备份；未处理前备份版本不写入本机，处理结果持久化留痕，首页同步显示待处理冲突数。
- **断点续传与幂等**：旧版本（v1）备份导入时自动升级；按块写入并在 `meta` 表持久化进度，中断/失败后用同一文件重导即从断点续传，重复导入不会多出一份；解析失败时不触碰本机库。

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbherbprocess-db`），表：`herbs`、`methods`、`batches`、`samples`、`meta`、`conflicts`。
- `db.version(1)` 建表声明索引；`db.version(2).upgrade(...)` 为 `batches` 增加 `locked` 索引并回填历史数据；`db.version(3)` 新增 `conflicts` 表（合并冲突留痕）。升级前可用顶栏「导出备份」导出全量 JSON。
- 首次打开且表为空时写入一批示例台账（`src/utils/seed.ts`），便于直接查看各页面效果。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。
