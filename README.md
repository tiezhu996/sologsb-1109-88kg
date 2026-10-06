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
| 路由 | React Router 6（5 条路由） |
| 状态 | Zustand（herbStore / methodStore / batchStore / sampleStore / syncStore） |
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
│       ├── types/             # herb-material / processing-method / process-batch / retain-sample / sync
│       ├── stores/            # herbStore / methodStore / batchStore / sampleStore / syncStore
│       ├── components/common/ # RatioCalculator / FireLevelTag / CabinetGrid / FilterBar / StatBadge / ProcessTimeline / EmptyPanel
│       ├── components/        # ImportBackupModal（导入对账合并向导）
│       ├── hooks/             # useHerbFilter / useRatio
│       ├── pages/             # ProcessBoard / HerbList / MethodList / BatchBoard / SampleLedger / ConflictCenter
│       ├── router/index.tsx   # 路由表
│       └── utils/             # db.ts / degree.ts / export.ts / seed.ts / id.ts / sync.ts（对账合并引擎）
```

## 功能与路由

| 路由 | 页面 | 说明 |
| --- | --- | --- |
| `/` | 首页总览 | 待炮制批次、留样到期提示、最近工序时间线、平均得率、备份对账冲突数 |
| `/herbs` | 药材台账 | 药材与批次登记，按基原/药用部位筛选，按药材分组汇总 |
| `/methods` | 炮制方法 | 辅料比例、火力与判断标准维护，辅料折算台与复制派生 |
| `/batches` | 工序记录台 | 选方法自动带出辅料比例/火候/判断标准，录入火候与得率并判定程度 |
| `/samples` | 留样台账 | 柜位网格、到期提醒、按日期追加观察记录 |
| `/conflicts` | 对账中心 | 他机备份同名冲突逐字段对比选择，已处理记录重开仍在 |

## 跨机备份对账合并

另一台电脑导出的备份包从顶栏「导入备份」进入，**按自然键对账合并，绝不整库覆盖**：

- **对账键**：药材按「药材名 + 批号」、炮制批次按「生产批号」、留样按「留样编号」、炮制方法按「方法名 + 辅料 + 比例 + 火力 + 时长 + 判断维度」。
- **自动合并**：仅备份中存在的记录并入本机，本机独有记录保留；有共同基线时只有一侧改过的自动取较新版本。
- **锁定批次优先**：炮制批次一经锁定即以锁定版本为准（锁定瞬间固化药材名与炮制方法快照），之后炮制方法或药材被修改、或备份侧改动，都不回头改写已锁定批次。
- **同名两边都改**：在「对账中心」逐字段列出供人工选择保留本机或备份版本，**未决前备份侧记录不入本机**；父记录（药材/方法/批次）未决时，关联的批次/留样先暂挂，裁决后自动续传并入并重写跨表引用。
- **断点续传 / 失败重试**：旧版本备份先升级再按分块写入暂存区，导入中断或合并失败（单事务回滚，本机库原样保留）后可从断点续传或重试，无需重新解析。
- **重复导入幂等**：同一备份文件按内容指纹识别，重复导入不会多出一份；人工裁决过的版本同文件再导入不会翻盘。
- 首页与顶栏实时显示未决冲突数；所有冲突处理记录（含锁定自动裁定）持久保留，重开应用仍在。

## 数据存储说明

- 全部数据存于浏览器 IndexedDB（Dexie，库名 `gbherbprocess-db`），表：`herbs`、`methods`、`batches`、`samples`、`meta`、`conflicts`、`importSessions`、`staging`。
- `db.version(1)` 建表声明索引；`db.version(2).upgrade(...)` 为 `batches` 增加 `locked` 索引并回填历史数据；`db.version(3).upgrade(...)` 建立跨机对账所需的冲突/会话/暂存表，回填 `updatedAt`，并为历史已锁定批次补锁定版本快照、为留样补关联批号快照。升级前可用顶栏「导出备份」导出全量 JSON。
- 首次打开且表为空时写入一批示例台账（`src/utils/seed.ts`），便于直接查看各页面效果。
- 容器无状态：不使用数据库服务、不挂载命名卷，`docker compose down` 后数据仍留在浏览器中。

## 测试

```bash
cd frontend
npm test        # vitest：对账合并引擎用例（fake-indexeddb）+ 应用外壳渲染冒烟
npm run build   # tsc --noEmit 类型检查 + 生产构建
```
