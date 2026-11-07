# Translation Kernel v0.1.0 交付报告（历史）

交付日期：2026-10-08（Asia/Singapore）。完整验证证据见 [verification.md](verification.md)、[性能原始数据](benchmark.json) 和 [公开网站在线抽样](live-verification.json)。

1. **架构**：纯 TypeScript 微内核与事件驱动架构。内核只承担文本发现、语义分段、翻译调度、缓存及可恢复渲染；AI 问答、媒体、学习、同步、归档均未进入核心。
2. **仓库结构**：`apps/browser-extension` 为 MV3 应用；`packages` 包含 core、dom、segmenter、renderer、provider-api、action-api、event-api、adapter-api、rules、config、shared、sdk；`examples`、`tests`、`scripts`、`docs` 独立。
3. **核心模块**：HTML Adapter 用文本节点映射聚合嵌套 inline 内容；Router 提供批处理、超时、重试、回退和取消；缓存采用最多 1,000 条、一小时 TTL 的 LRU；Renderer 使用纯文本译文节点与恢复机制。
4. **公共 API**：`translate/translateBatch`、`TranslationKernel`、`getSegments/exportDocument`、`ActionRegistry`、类型安全 `EventBus`、`DocumentAdapter`；API 版本与配置 schema 均为 1。SDK 附带 ESM 与 TypeScript 声明。
5. **扩展机制**：第三方通过 Provider/Action/Event/Adapter 契约接入。DOM 引用不进入公共文档模型；事件为独立快照，监听器异常不影响核心。
6. **Provider**：Google 无密钥便捷接口、OpenAI-compatible、Ollama-compatible 示例。模型、密钥、地址、自定义 headers、超时可配置；v0.1 使用非流式完整批次。
7. **示例**：Wiktionary、ChatGPT、Claude、Google/Wikipedia 搜索、自定义 URL；内存文档 Adapter；JSON 导出、Anki 行数据、ArchiveBox envelope、本地词典查询投影。桥接示例不实现完整外部客户端。
8. **安全**：activeTab 按需注入；无必需页面 host 权限；Provider 域名单独申请；密钥只对可信扩展页面可见；消息 sender、batch 和 ID 校验；API 请求省略 cookies、拒绝重定向；纯文本输出、严格 CSP；配置导出移除密钥及所有自定义 headers。
9. **性能**：1,001/10,001/50,001 DOM 节点的扫描耗时为 20.7/75.9/462.5 ms，渲染为 3.0/11.3/82.6 ms，恢复为 0.4/2.0/3.5 ms。单次本机结果，不作为跨机器承诺；内存只提供文本字节估计，未宣称堆内存认证。
10. **测试**：21 个 unit/DOM/lifecycle 测试、11 个真实扩展 E2E 通过；React/Vue 实际组件更新、动态插入、恢复重译、fallback、错误、取消/停止、配置部分导入导出与密钥隔离均有覆盖。公开 Wikipedia/GitHub/MDN/React 文档使用实际 Google 接口抽样英译中并反译成功。
11. **CI**：GitHub Actions 配置格式、lint、typecheck、unit、E2E、examples、build、audit、package；Release 以发布提交 CI 成功为门槛。确切运行结果和链接以最终交付消息及 Actions 页面为准。
12. **Bundle**：扩展 JS+CSS 共 42,532 字节；完整安装目录含法律文本共 209,454 字节；SDK ESM 约 30.2 kB，另有声明文件。React/Vue 仅用于测试，不进入发布包。
13. **限制**：Firefox、Shadow DOM/iframe、真实账户型 OpenAI/Ollama 服务、浏览器商店审核、首次权限弹窗人工认证与长时间内存 soak 尚未验证。Google 便捷接口为非官方接口，存在可用性/限流风险；语言检测仅保守识别文字系统。
14. **未来扩展**：PDF/EPUB/Markdown/OCR/字幕 Adapter、独立词典/归档/学习工具可在仓库外实现；核心不扩展产品边界。Streaming、Firefox 包装与更丰富站点规则可通过现有契约逐步添加。
15. **文件变更**：新建整个独立仓库；公共源文件、浏览器应用、测试、构建/打包/在线抽样脚本、CI/Dependabot、README/架构/安全/贡献/行为规范/Changelog、五份 API 文档与许可证边界齐备。没有修改相邻既有项目。
16. **Git / commit**：独立 `main` 分支，发布源码由 `v0.1.0` 标签定位；最终提交 SHA、工作区状态与远程地址见最终交付消息。`.local`、依赖、构建和测试产物不提交。
17. **发布就绪**：可安装 Chromium MV3 ZIP、SDK ZIP 和 SHA256SUMS；MPL-2.0 用于可复用内核，GPL-3.0-or-later 用于完整浏览器应用，第三方保留原许可证，遵循工作室 LICENSE_POLICY。CI 通过后发布 GitHub Release；不等同于 Chrome Web Store 发布。

设计原则：Make translation infrastructure boring, small and dependable — and make everything else extensible.
