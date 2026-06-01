# lolmasite

lolmasite 是一个面向《英雄联盟》玩家的 Windows 桌面战绩分析工具。它会连接本机正在运行的 League Client（LCU），读取当前账号最近的单双排对局数据，并结合 AI 生成中文复盘报告，帮助你快速判断最近几局更像是正常波动、本人发挥问题、队友状态劣势，还是对手状态压制。

## 主要功能

- 自动检测本机 LOL 客户端和当前登录账号。
- 读取最近单双排对局、胜负、英雄、KDA、伤害、经济、补刀等数据。
- 对比我方和对手玩家的近期状态、排位背景和分路表现。
- 识别热手/冷手、低状态玩家、疑似双排影响等匹配压力特征。
- 调用用户配置的 AI 接口生成中文复盘报告。
- 支持 Windows 安装包发布和 GitHub Releases 自动更新。

## 使用前准备

1. 打开并登录《英雄联盟》客户端，进入大厅。
2. 启动 lolmasite。
3. 在应用内检测 LOL 客户端。
4. 配置 AI 接口地址、API Key 和模型。
5. 选择要读取的最近对局数量，然后生成分析报告。

## 隐私说明

应用读取的是你本机 LOL 客户端开放给本地程序的 LCU 数据，用于展示和分析最近对局。AI 分析时会把对局摘要发送到你配置的 AI 接口；请确认你信任所填写的 AI 服务地址和 API Key。

## 开发启动

```powershell
npm install
npm run electron:dev
```

## 本地构建

```powershell
npm run build
```

## 打包 Windows 正式安装包

```powershell
npm run dist
```

打包产物会生成到 `release/` 目录。正式发布时需要上传安装包、`latest.yml` 和 `.blockmap` 文件到 GitHub Release，自动更新依赖这些文件。

## 发布新版本

1. 更新 `package.json` 里的版本号。
2. 提交代码并推送到 GitHub。
3. 创建版本 tag，例如：

```powershell
git tag v0.1.1
git push origin v0.1.1
```

4. GitHub Actions 会构建 Windows 安装包并发布到 GitHub Releases。

## 自动更新

正式安装版启动后会后台检查 GitHub Releases。发现新版本后会自动下载，下载完成会提示用户重启应用完成更新。

开发模式不会检查更新。
