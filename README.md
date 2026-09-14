# 微博公交监控

监测 `sources.json` 中的官网和微博页面，只保留公交线路、停运、绕行、站点、班次等相关消息，并和上次快照比较。一条微博动态保存为一条消息；非微博来源从列表页识别同站公告链接，每个详情页的标题与正文合并保存为一条公告，不按换行拆分。第一次运行用于建档，从第二次开始才会报告新增内容，避免把历史公告全部当成更新。

## 安装和使用

```powershell
npm install
npm run login       # 微博要求登录时执行一次，浏览器内扫码或自行登录
npm run check       # 立即检查一次
npm run watch -- --minutes 30
npm run serve       # 启动监控网站：http://localhost:9093
```

结果写入 `outputs/latest.md` 和 `outputs/latest.json`，历史快照保存在 `work/state/snapshots.json`。关闭监测窗口即可停止 `watch`。

`sources.json` 中 `enabled: false` 表示原清单中的划线停用来源，或未提供网址的来源。改成 `true` 即可启用。

默认监测近 5 天：微博页面会持续向下加载并累积虚拟列表中出现过的每批消息，直到连续出现 5 天前的消息或到达页面底部；带发布时间的旧消息会被排除，历史记录也只保留该窗口。公告时间只取微博消息时间或官网公告的发布时间元数据，不使用抓取/录入时间替代。可用 `node src/cli.js check --days 7` 调整为 1 到 30 天，服务模式可设置 `LOOKBACK_DAYS`。

非微博来源默认最多抓取 30 个相关详情页。可在单个来源上配置 `"maxArticles": 20`，范围为 0 到 30；设为 0 时只提取列表页。

## 登录和隐私

工具不会索取或保存微博密码。`npm run login` 会打开一个独立 Edge 窗口，由你直接在微博页面完成扫码/登录；Cookie 只保存在本机的 `work/browser-profile`。不要把这个目录上传或分享。

也可将浏览器中已登录 `weibo.com` 后复制的完整 Cookie 通过标准输入交给 `npm run import-cookies`。导入器会访问微博页面验证登录墙；显示 `"loggedIn": true` 才表示可用于抓取。

## 定时运行

常驻运行可用 `npm run watch -- --minutes 15`。需要开机自动运行时，可再将 `npm run check` 配置到 Windows 任务计划程序。抓取失败不会覆盖该来源上一次的有效快照。

网站默认监听 `0.0.0.0:9093`，启动 5 分钟后首次自动检查，之后每 10 分钟检查一次。来源使用单页面串行抓取，每个来源后冷却 1 秒，进程使用低于正常优先级；按最近一轮耗时预计约 9 分钟完成。页面仍可手动触发。可通过环境变量覆盖：`PORT`、`HOST`、`CHECK_INTERVAL_MINUTES`、`CHECK_START_DELAY_MINUTES`、`CHECK_CONCURRENCY`、`SOURCE_COOLDOWN_MS`。
