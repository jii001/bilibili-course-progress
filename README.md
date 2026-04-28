# Bilibili Course Progress

一个用于统计 Bilibili 多 P 视频课程学习进度的 Tampermonkey/Violentmonkey 用户脚本。

它按真实视频时长计算进度，而不是只看“第几 P / 共几 P”。
<img width="644" height="963" alt="image" src="https://github.com/user-attachments/assets/0be0bea9-2013-4e1a-b642-edf1d83f3134" />

## 功能

- 自动识别当前 Bilibili 视频 BV 号和 `p` 分 P 参数
- 读取所有分 P 的标题和时长
- 读取当前播放器的 `video.currentTime`
- 计算总课程时长、已看时长、剩余时长和时间进度
- 支持按每天学习小时数估算剩余天数
- 支持导出 CSV，便于导入 Excel、WPS、Notion 或 Obsidian
- 支持刷新和收起悬浮面板

## 安装

1. 安装一个用户脚本管理器：
   - [Tampermonkey](https://www.tampermonkey.net/)
   - [Violentmonkey](https://violentmonkey.github.io/)
2. 打开脚本文件：
   - [`bilibili-course-progress.user.js`](./bilibili-course-progress.user.js)
3. 复制全部内容，新建用户脚本并保存。
4. 打开 Bilibili 多 P 视频页面，例如：

```text
https://www.bilibili.com/video/BVxxxxxxxxxx/?p=2
```

页面右侧会显示“课程进度”悬浮面板。

## 计算方式

```text
总课程时长 = 所有分 P 时长求和
已看时长 = 当前 P 之前所有分 P 时长 + 当前 P 已播放时间
学习进度 = 已看时长 / 总课程时长
```

注意：这个脚本默认你是从第 1 P 按顺序看到当前 P。  
如果你跳着看，它统计的是“按顺序内容覆盖进度”，不是 Bilibili 的真实观看历史。

## 导出 CSV

点击面板中的“导出CSV”，会生成包含以下字段的表格：

- P
- 标题
- 本 P 时长
- 累计时长
- 累计进度

## 隐私说明

脚本只在 Bilibili 视频页面运行。

脚本会请求 Bilibili 官方公开接口：

```text
https://api.bilibili.com/x/web-interface/view?bvid=...
```

用于读取当前视频的分 P 信息。脚本不会上传你的观看记录、账号信息或页面数据到第三方服务器。

## 许可证

MIT License
