# Chrome Web Store — Short Summary

> 用于 Chrome Web Store 商品详情页 "Summary" 字段（短描述，**严格限制 132 字符**）。
> ⚠️ Summary 由 manifest.config.ts 的 `description` 字段自动填充，无法在 dashboard 单独修改 —— 换文案必须随新版本发布。

---

## English (current, 132 chars max)

```
Batch and bulk image downloader. Finds every image on a page, saves as ZIP, multi-tab extract, AI tags, duplicate detection.
```

字符数：**124 / 132** ✅

> 2026-11-26 改动：把 `Batch and bulk image downloader` 提到句首，为「batch image downloader」（当时排第 11）与 bulk 词补足位。上一版以「Image downloader」开头，只含 batch 不含 bulk。

---

## ⭐ 上一版（v1.0.13 已生效，保留作备选）

```
Image downloader that finds every image on a page. Batch save as ZIP, multi-tab extract, AI tags, duplicate detection and more.
```

理由：当前版是纯功能名词堆砸，缺主搜索词「image downloader」（title 里只有动词形式 Download）；新稿首句 = 品类词 + 核心差异化（finds every image），后句保留高价值功能词。符合官方「首句含核心动词、突出主用例」要求。

---

## 备用变体（如需 A/B 测试）

### Variant A — 强调"漏图"痛点

```
Find every image on any page — including the 60-90% that other tools miss. Batch ZIP, multi-tab, similar detection.
```

### Variant B — 强调专业用户

```
Pro-grade image harvester for designers and researchers. Multi-tab batch, similar detection, color extract, reverse search.
```

### Variant C — 强调免费起步

```
Free smart image extractor. Batch download as ZIP, multi-tab scan, similar image detection, color palette extract.
```

---

## ⚠️ 提交前必检

- 字符数 ≤ 132（含空格）
- 首句必须包含核心动词（Find / Download / Extract / Batch）
- 不可使用全大写、感叹号、emoji
- 不可包含 "best" / "#1" / "world's" 等违规词
