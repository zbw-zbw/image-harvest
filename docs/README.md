# Image Harvest — Documentation

> 公开文档仅包含 Chrome Web Store 上架材料。推广策略、广告投放、版本笔记、PRD 等商业敏感文档仅本地保留，不随开源仓库分发。

---

## 📂 目录结构

```
docs/
├── README.md                      # ← 你在这里（公开）
├── chrome-store/                  # Chrome Web Store 上架材料（公开）
│   ├── description.md             #   完整功能描述
│   └── summary.md                 #   132 字符短描述
│
│── [以下全部 .gitignore 排除，仅本地保留] ──
│
├── launch/                        # 🚀 推广发布
│   ├── strategy-zh.md             #   中文推广策略（平台分级 + 时间表）
│   ├── strategy-en.md             #   英文推广策略
│   ├── bio-templates.md           #   社交媒体 bio 模板
│   ├── youtube-seo.md             #   YouTube SEO 优化方案
│   ├── tracking-template.md       #   追踪表模板
│   ├── README.md / README.zh.md   #   推广内容索引
│   ├── zh/                        #   34 个中文平台文案
│   └── en/                        #   34 个英文平台文案
│
├── ads/                           # 💰 付费广告
│   └── google-ads-strategy.md     #   Google Ads 投放方案
│
├── release/                       # 📦 版本发布
│   ├── v1.0.1-notes.md            #   GitHub Release 粘贴版
│   └── social-preview-design.md   #   Social Preview 设计方案
│
└── product/                       # 📋 产品规划
    └── PRD.md                     #   产品需求文档
```

---

## 📋 Chrome Web Store 材料

提交到 Chrome Web Store 商品详情页时直接复制使用。

| 文件                                                           | 用途                                     | 对应字段               |
| -------------------------------------------------------------- | ---------------------------------------- | ---------------------- |
| [`chrome-store/description.md`](./chrome-store/description.md) | 完整功能描述（带 emoji + Free/Pro 对比） | "Detailed description" |
| [`chrome-store/summary.md`](./chrome-store/summary.md)         | 132 字符短描述 + 3 个 A/B 测试备选       | "Summary"              |

---

## 🔒 私有文档说明

以下内容**不包含**在本开源仓库中（已被 `.gitignore` 排除）：

| 目录       | 内容                                                               |
| ---------- | ------------------------------------------------------------------ |
| `launch/`  | 推广策略、34 中文 + 34 英文平台文案、YouTube SEO、bio 模板、追踪表 |
| `ads/`     | Google Ads 投放方案（后续可能扩展 Facebook / Twitter Ads）         |
| `release/` | GitHub Release 粘贴版笔记、Social Preview 设计方案                 |
| `product/` | 产品需求文档（PRD）、未来功能路线图                                |

这些文档属于**商业运营资产**，仅本地保留。如果你是用户或贡献者，无需访问这些文档即可理解和使用本项目。

---

## 🚀 快速上手

| 我想...           | 去哪里                                                                                        |
| ----------------- | --------------------------------------------------------------------------------------------- |
| 安装产品          | [Chrome Web Store](https://chromewebstore.google.com/detail/iecgnjidmogebokcfnejncgnelcepffo) |
| 查看功能说明      | 官网 [image-harvest.kyriewen.cn](https://image-harvest.kyriewen.cn)                           |
| 贡献代码          | 根目录 [`CONTRIBUTING.md`](../CONTRIBUTING.md)                                                |
| 报告问题          | [GitHub Issues](https://github.com/zbw-zbw/image-harvest/issues/new/choose)                   |
| 提交 Chrome Store | [`chrome-store/description.md`](./chrome-store/description.md)                                |
