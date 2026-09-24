# Agent Note: 隔离交互 HTML 预览

Status: implemented

[English](2026-09-24-isolated-html-preview.md) | 中文

## Problem

HTML 报告可能需要本地图片、样式表和经典 JavaScript，同时保留源提供方的版本与读取权限。

开启代码工作工具还会开启无关能力，单独使用不透明源的脚本 iframe 也不能阻止网络请求。

CSP `connect-src 'none'` 不涵盖 WebRTC，子文档无需访问父源就能导航自身。

## Decision

现有[文档预览插件](../../../../packages/client/ui-sidebar-documentpreview/README.zh.md#how-it-reads)拥有 `html.mode`，其中 `coding-tools` 保留默认兼容行为，`static` 强制使用静态策略，`isolated-interactive` 提供单独选择的策略。

隔离策略复用原生 HTML 渲染器及其绑定原地址的 `workspaceFiles.readBytes` 回调。

有限资源包包含本地经典 JavaScript、自包含 CSS 和被动图片；缺失、外部、超限或不支持的依赖会在发布前失败。

在需要基于解析器的递归策略之前，保守拒绝 CSS 转义和递归资源结构。

Host 提供带空原生 `Connection-Allowlist` 响应策略和 CSP 的静态引导文档，不包含用户内容、资源代理、查询参数或报告端点。

不透明源框架最初仅包含可信代码。

它构造并关闭一个没有 ICE 服务器或 offer 的 WebRTC 连接，等待标识空允许列表的本地强制策略报告，之后父页面才发送打包后的文档。

这会证明浏览器的有效策略，无需根据版本、JavaScript API 名称或异常推断支持情况。

响应策略在文档替换后保留并管理 HTTP、WebRTC 和导航，CSP 则禁止后代文档、Worker、表单及不支持的资源。

渲染后的文档报告资源、脚本、Promise 和策略失败；父页面将消息绑定到当前框架及挂载令牌，并移除失败内容。

## Alternatives considered

**仅使用沙箱和 CSP。** 合成回环浏览器检查表明，即使设置 `connect-src 'none'`，仍存在自身导航和 WebRTC 外发路径。

**删除与网络相关的 JavaScript 全局对象。** 新 realm 可以恢复它们，因此 JavaScript 拒绝列表无法建立所需浏览器边界。

**使用 iframe 的 `connectionallowlist` 属性。** 受测浏览器实现了响应头，但并未强制执行该属性。

**根据 user agent 假定支持。** 发布开关、旧引擎和被剥离的响应头可能与浏览器声明的版本不同。

**添加独立渲染器、资源服务或公开策略注册表。** 当前 Config 和作用域文件读取器已经提供所需扩展点；可信静态引导文档不增加文件权限。

## Consequences

部署必须保留引导文档的响应头，没有正向强制策略报告的浏览器会在收到文档字节前显示不支持预览的消息。

本地报告没有配置网络报告目标。

基于文件的桌面加载无法使用此 HTTP 策略，预览也不限制脚本 CPU 或内存占用。

[浏览器回归](../../../../apps/web/tests/isolated-html-policy.e2e.ts)覆盖真实 Host 路由、原生策略、响应头剥离、策略不支持、打包资源以及回环 HTTP 和 UDP 接收器。

单元测试覆盖有限资源校验、同地址读取、父窗绑定质询、模式选择、失败反馈和资源释放。
