# LocalDeck

一个本地优先（local-first）的个人工作台，把日程、任务、商单、记账、饮食和训练收进同一个界面。数据全部存在你自己的设备上，不上传、不同步、不需要账号。

> 让时间有去处。

## 它能做什么

- **今日与本周**：按时间轴看今天要做什么，直接勾选完成
- **周日历**：任务安排到某天后可自动寻找空档，支持拖拽改期、拉伸改时长，重叠日程并排显示
- **专注计时**：默认 25/30 分钟起一段，结束时写入真实用时
- **商单看板**：未开始 → 进行中 → 已完成 → 已结算四列，记录执行价、打款额、接单与发布日期
- **稿件队列**：记录每篇内容的类型、状态、字数和待补点，并和商单关联；商单已完成但稿件未标记发布时会提示你核对
- **记账**：金额以「分」为单位存储，支持周/月/年/全部区间、分类汇总与支出趋势
- **饮食与训练**：冰箱库存（冷藏/冷冻/常温分栏、临期提示）、基于现有食材的搭配建议、训练记录与日历联动
- **个人产品与平台活动**：跟踪自己的项目阶段，以及各平台的活动档期与规则
- **复盘日志**：日 / 周 / 月复盘，按日期归档，可回看
- **智能助理**：接入任意 OpenAI 兼容 API，能回答问题，也能在明确授权后直接写数据
- **桌面端**：菜单栏常驻、全局快捷键唤起助理、到点自动生成复盘、每日本地备份

## 隐私

- 所有业务数据存在本地 SQLite（Cloudflare D1 兼容层），不经过任何第三方服务器。
- AI API Key 只写进本地数据库；页面读取配置时只返回「是否已配置」，不会把 Key 回传给浏览器。
- 唯一的对外请求是你自己配置的模型服务：对话或生成复盘时，会把近期任务、日程、训练、食材、支出等工作台摘要发送过去。具体发了什么可以直接读 `lib/personal-assistant.ts` 的上下文组装逻辑。
- 首次运行可以选择「载入演示数据」。演示内容全部是虚构的，带 `demo-` 前缀，随时可以在设置里一键清除。

## 快速开始

需要 Node.js 22.13 以上。

```bash
npm install
npm run dev
```

打开终端里显示的地址即可。首次进入是空白工作台，可以选择载入演示数据先看效果。

配置助理：进入 **设置 → 个人助理**，填三项：

| 字段 | 说明 |
| --- | --- |
| API 地址 | OpenAI 兼容服务的 Base URL，例如 `https://.../v4` |
| 对话模型 | 模型名 |
| API Key | 只保存在本地 |

## 桌面端

从源码运行：

```bash
npm run desktop        # 构建并启动 Electron
npm run desktop:pack   # 生成可直接打开的 .app（macOS arm64）
```

> 预编译的 macOS / Windows 安装包正在准备中，会在 Release 页面提供。当前从源码运行需要本机已安装 Node.js。

## 技术栈

- React 19 + Next.js App Router（经 vinext 构建）
- TypeScript 5.9
- Cloudflare D1 / SQLite + Drizzle ORM
- Electron + electron-builder
- 无服务端依赖：本地 workerd 运行时提供同一个 `/api/workspace` 接口

## 项目结构

```text
app/
  workspace-client.tsx   全部视图与前端交互
  api/workspace/route.ts 单一 HTTP 契约（GET/POST/PATCH/DELETE）
db/
  schema.ts              Drizzle 表定义
  runtime.ts             运行时建表
lib/
  brand.ts               产品名等单点常量
  deals.ts               商单阶段、类别与视图映射
  demo-data.ts           虚构演示数据
  personal-assistant.ts  AI 请求、结构化动作、复盘生成与重试
  task-scheduler.ts      任务自动排时间
  calendar-layout.ts     日历时长与重叠布局
  expenses.ts            金额与日期规范化
  backup.ts              本地备份
desktop/
  main.cjs               本地服务、托盘、快捷键、后台调度
  preload.cjs            受隔离的 IPC
tests/                   日历、排程、记账、商单与渲染回归
```

## 开发

```bash
npm test         # 构建 + 回归测试 + 隐私检查
npm run lint
npx tsc --noEmit
```

`npm test` 会重新生成 `dist/`，运行前请先退出正在使用的桌面端。

## 设计约束

这个项目刻意保持单用户、单机、模块化单体。以下事情不在计划内：多设备实时同步、协作与权限、云端账号。如果你需要这些，它不是合适的起点。

## License

MIT
