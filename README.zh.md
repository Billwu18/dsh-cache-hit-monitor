# 缓存命中监视器

以一块仪表盘的形式，在 DSH 右侧栏实时显示当前会话的提示词缓存遥测。

[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)
[![DSH](https://img.shields.io/badge/DSH-%E2%89%A50.1.7--rc.1-4b5563.svg)](#兼容性)
[![Platform](https://img.shields.io/badge/platform-web-4b5563.svg)](#兼容性)

[English](README.md) · **中文说明**

![缓存命中监视器，深色主题](assets/screenshot-dark.png)

---

## 这个插件做什么

它在 DSH 右侧栏新开一个标签页，读取 Host 已经在发布的 `tokenUsage` 与
`contextPressure` 会话投影，用四块平面仪表面把它们画出来：

| 表面 | 内容 |
| --- | --- |
| **命中率** | 用 5×7 点阵显示会话缓存命中率，另有已结算请求数、上一条请求的命中率、它的时长，以及相对当前提示词总量的 28 灯进度条。 |
| **寄存器阵列** | 四个互不重叠的缓存分桶——缓存读取、缓存写入、未命中输入、输出——给出会话累计值与按比例点亮的灯行。 |
| **反应堆芯** | 每一条已结算请求一个格子，最新在前。墨色深浅是该次请求的命中率，直径是它相对盘面最大请求的体积，越旧越暗。 |
| **上下文压力** | 压力 token 相对上下文窗口的占用。 |

标签页每次页面加载后会自动打开一次，不必去标签向导里翻找；关闭方式和其他标签页一样。

### 命中率是怎么算的

```
命中率 = 缓存读取 / (缓存读取 + 缓存写入 + 未命中输入)
```

输出 token 被**刻意排除**。生成的 token 永远不参与缓存，把它算进分母只会让数字好看
——一次长输出会把冷启动的提示词伪装成热的。

### 反应堆芯细节

一个格子 = 面板挂载期间结算的一条请求，从左上角开始按最新在前排列。盘面始终是
整数行，且永远不会比它真正记录的history更高，所以刚开的会话只会显示短短一行，
而不是一大片空栅格。

- **墨色** —— 该请求的命中率，走在单色明度梯上。
- **直径** —— `sqrt(该请求 token / 盘面最大请求)`，让小的请求在冷启动大请求旁边
  也不至于看不见。
- **衰减** —— 越靠下越暗。

每个格子都带 `title`，写清它自己的读取 / 写入 / 未命中 / 输出拆分，
所以这张图是可以被逐格核对的，而不是只能信。

---

## 安装

### 从 GitHub 安装

```sh
dsh plugin --profile web add github:Billwu18/dsh-cache-hit-monitor
```

也可以在 Web 界面的插件管理器里安装。

### 手动安装（开发用）

```sh
git clone https://github.com/Billwu18/dsh-cache-hit-monitor
dsh plugin --profile web add /绝对路径/dsh-cache-hit-monitor
```

然后刷新页面。Host 按修改时间重新读取插件产物，所以改 `client.js` 只需刷新，
不必重启 `dsh web`。

### 依赖要求

- DSH `>=0.1.7-rc.1 <0.2.0-0`
- Node `>=20`（仅供测试脚本使用，插件本身跑在浏览器里）
- React 18 或更新版本，由 DSH Web 界面提供

没有第三方依赖、没有构建步骤、没有安装脚本。

---

## 怎么读这块仪表

- 标题旁的**实心红点**表示本会话已经有请求结算；**空心圆环**表示还没有记录到任何请求。
- **寄存器阵列**给的是会话累计值，不是单次请求值；灯的长度按当前最大的那个分桶取比例。
- **盘面下的 0 % → 100 % 色带**就是墨色梯度，用来把格子的明度读回成数字。
- **ROWS 4 / 6 / 9** 设定盘面的最大行数。列数由侧边栏自己决定：面板会量出当前宽度
  能放几列，盘面按整行生长，所以同一份历史在窄侧栏里会占更多行。
- **CLR** 清空当前会话记录到的历史。它不会碰 Host 侧的任何数据。

---

## 工作原理

Host 半侧是刻意留空的（`index.js` 只导出一个空的 `apply`）。它存在的意义是让这个
bundle 有一行 Loader 记录，从而能像其他插件一样被启用、停用和检查。

面板显示的一切都是 Host 已经算好的：
[`@deepseek-ai/dsh-token-meter`](https://www.npmjs.com/package/@deepseek-ai/dsh-token-meter)
把持久会话日志折叠成 `tokenUsage` 与 `contextPressure` 两个投影。Client 半侧通过
`useProjection` 从插槽 props 里读到它们，然后渲染。

客户端 bundle 是单文件（`client.js`），采用 DSH 的浏览器模块格式，只用 React 和
标准浏览器 API：

- 盘面用 `getComputedStyle` 加 `ResizeObserver` 从真实布局量出自己的列数，并在绘制前
  重渲染一次。如果量不到，盘面就不设上限、随数据增长。
- 「时长」的时钟住在它自己的组件里，并按它实际打印的精度走（1 秒 / 5 秒 / 30 秒），
  所以闲置的面板不会每秒把整块盘面重新协调一遍。
- 记录下来的历史放在按会话索引、有上界的模块级缓存里，因此能扛过切换标签页造成的
  重新挂载；标签页同时也注册了 `keepMounted: true`，从根本上避免那次重新挂载。

### 隐私

面板只读取本地会话投影。它不发起网络请求、不上报遥测、不在浏览器标签页之外留下任何
数据；清空历史只动内存状态。

---

## 兼容性

| | |
| --- | --- |
| DSH | `>=0.1.7-rc.1 <0.2.0-0` |
| 平台 | `web`（`dsh.client.platform`） |
| React | 18 或更新版本（由宿主提供） |
| 主题 | 两种都支持。仪表面在两种主题下都刻意保持深色，外围外壳跟随 `--dsw-*` 主题变量。 |
| 语言 | 中文与英文。其他语言回退到英文。 |
| 宿主 | 任何提供 `sidebarRightTabs` 服务的宿主。 |

---

## 开发

做这个插件不需要装任何依赖——测试直接跑在原生 Node 上，加载真实的 `client.js`。

```sh
node test/run-all.mjs     # 四个套件全跑
node test/preview.mjs     # 生成可用于截图的 HTML
```

### 仓库结构

```
dsh-cache-hit-monitor/
├── client.js              全部浏览器侧逻辑（React，DSH 模块格式）
├── index.js               宿主侧（刻意留空）
├── cordis.patch.yml       安装这个插件的 Loader 行
├── package.json           清单：dsh.bundle + dsh.client
├── icon.svg               插件卡片图标
├── screenshots.json       市场截图，路径相对本文件
├── locale/
│   ├── en.json            插件卡片标题与描述
│   └── zh.json
├── assets/                README 引用的截图
└── test/
    ├── run-all.mjs        依次跑下面四个套件
    ├── preview.mjs        把面板渲染成独立 HTML
    ├── wiring.test.mjs    bundle 身份、effect、标签页与插槽注册
    ├── render.test.mjs    渲染树：形状、数量、无 NaN、key 覆盖
    ├── persist.test.mjs   历史与深度能否扛过重新挂载
    └── robust.test.mjs    对抗性输入与本地化覆盖
```

### 测试是怎么跑的

这里没有 DOM，也没有测试框架。每个脚本都会伪造 `window.__ModuleLoader__` 来截获
bundle，伪造 `react`，把真实的 `apply(ctx)` 跑在一个桩 context 上，然后用一个很小的
渲染器驱动注册进去的组件。

这足以断言真实行为：插件注入了哪些服务、往哪个插槽注册了什么、渲染树里有多少格子和
灯、历史能否扛过重新挂载，以及是否存在某条可达输入会让它抛异常、或把
`undefined`/`NaN` 漏进样式字符串。

| 套件 | 断言内容 |
| --- | --- |
| `wiring` | 模块 id、声明的注入、`ctx.effect` 注册项、标签页定义（含 `keepMounted`）、两个按 key 的插槽注册，以及 body 确实是个组件。 |
| `render` | 渲染树形状：点阵点数、堆芯格数与格内圆点、灯数、寄存器行数、恰好一个红色元素、任何样式里都没有 `undefined`/`NaN`，以及数组里的每个元素都带 React key。 |
| `persist` | 一套真实的按实例 hook 运行时：记录一条请求、改深度、卸载、重新挂载——历史、深度与 `keepMounted` 全部验证。 |
| `robust` | 16 个对抗场景（投影缺失或抛异常、token 数为 `NaN`/`Infinity`/负数/字符串、没有 sessionId、没有翻译座位、空历史到一万条）都必须渲染成功，且每个本地化键在中英两本词典里都存在。 |

---

## 许可

[MIT](LICENSE) © 2026 Billwu18
