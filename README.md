# 公交线路更新监测器

监测 `sources.json` 中的官网和微博页面，只保留公交线路、停运、绕行、站点、班次等相关文本，并和上次快照比较。第一次运行用于建档，从第二次开始才会报告新增内容，避免把历史公告全部当成更新。

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

## 登录和隐私

工具不会索取或保存微博密码。`npm run login` 会打开一个独立 Edge 窗口，由你直接在微博页面完成扫码/登录；Cookie 只保存在本机的 `work/browser-profile`。不要把这个目录上传或分享。

## 定时运行

常驻运行可用 `npm run watch -- --minutes 15`。需要开机自动运行时，可再将 `npm run check` 配置到 Windows 任务计划程序。抓取失败不会覆盖该来源上一次的有效快照。

网站默认监听 `0.0.0.0:9093`，每 3 分钟自动检查，也可在页面上手动触发。可通过环境变量覆盖：`PORT`、`HOST`、`CHECK_INTERVAL_MINUTES`。
