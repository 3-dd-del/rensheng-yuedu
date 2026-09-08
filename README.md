# 人生阅读 · MVP

本地优先的个人电子阅读器：在浏览器里导入 TXT 书籍、翻页阅读、断点续读。

## 技术栈

React + TypeScript + Vite；IndexedDB（Dexie）保存书籍与进度；导入解码与指纹计算在 Web Worker 中完成，避免大文件阻塞界面。

## 开发

```bash
pnpm install
pnpm dev        # http://127.0.0.1:48123
```

## 构建与验证

```bash
pnpm typecheck
pnpm test
pnpm build
```

## 本地运行与桌面入口

```bash
pnpm build
pnpm desktop   # 在桌面创建「人生阅读」入口
```

双击桌面「人生阅读」图标：若本地服务未启动会自动拉起并打开默认浏览器，已启动则直接打开。

应用底部/书架的「退出本地服务」按钮可停止后台服务。浏览器关闭不会停止服务。

## 数据与备份

书籍、进度和阅读设置全部保存在本机浏览器（与该地址绑定的 IndexedDB）中。书架页提供「导出书库 / 导入备份」，换浏览器或清理缓存前请先导出。

## 项目结构

```text
src/
  app/        路由与页面：书架、阅读、导入
  core/       存储、编码识别、分页引擎、进度
  workers/    导入 Worker
  features/   导入与书库界面
  test/       测试辅助
scripts/      本地服务与桌面入口
docs/         技术方案与产品设计
```
