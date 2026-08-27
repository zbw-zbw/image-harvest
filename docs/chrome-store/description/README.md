# Chrome Web Store — Full Description（15 语言版）

> 每个受支持语言一个独立文件，内容为 CWS 商品详情页 Description 字段的**完整纯文本**。
> 文件里没有任何代码块或标题包裹 —— 打开文件后 Cmd+A 全选、Cmd+C 复制，整份直接粘贴到 CWS 开发者后台对应语言的 description 即可。语言靠文件名区分。
> CWS 不支持 Markdown，粘贴的是纯文本（emoji 正常显示）。

## 文件清单与 CWS 后台对照

| 文件                                           | CWS 后台语言下拉显示                            |
| ---------------------------------------------- | ----------------------------------------------- |
| [description-en.md](./description-en.md)       | English（默认源文件，其他语言都从它翻译）       |
| [description-zh_CN.md](./description-zh_CN.md) | 中文（简体）                                    |
| [description-zh_TW.md](./description-zh_TW.md) | 中文（繁体）                                    |
| [description-ja.md](./description-ja.md)       | 日本語                                          |
| [description-ko.md](./description-ko.md)       | 한국어                                          |
| [description-es.md](./description-es.md)       | Español                                         |
| [description-pt.md](./description-pt.md)       | Português (Brasil) 与 (Portugal) 共用同一份文本 |
| [description-fr.md](./description-fr.md)       | Français                                        |
| [description-de.md](./description-de.md)       | Deutsch                                         |
| [description-it.md](./description-it.md)       | Italiano                                        |
| [description-nl.md](./description-nl.md)       | Nederlands                                      |
| [description-hi.md](./description-hi.md)       | हिन्दी                                          |
| [description-ar.md](./description-ar.md)       | العربية                                         |
| [description-th.md](./description-th.md)       | ไทย                                             |
| [description-ru.md](./description-ru.md)       | Русский                                         |

注：插件 `_locales` 共 15 种语言，与上表一致。早期 listing 里的 Polski 已在 v1.0.x 被 हिन्दी 取代，各语言版本第 13 个功能块的语言清单均为 15 语最新名单，不要再写 Polski。

## ⚠️ 同步维护约定（加新功能必读）

**description-en.md 是唯一真源（source of truth）。任何功能/权益文案变更按此流程执行：**

1. 先改 `description-en.md`（文案定稿）；
2. 同步改其余 14 个 `description-*.md` —— 对应位置增删区块并翻译；链接穿透、批量高亮等功能块的既有译文措辞保持不动，只动变化的部分；
3. 同步更新主文件 [../description.md](../description.md) 头部的「最后更新」标记；
4. 随下一个插件版本提审时，把 15 份文本逐个粘贴到 CWS 后台各语言的 description（CWS 后台是每语言一份独立全文，互不联动，漏贴 = 该语言用户看到旧描述）；
5. 若变更涉及短摘要，另见 [../summary.md](../summary.md)（132 字符限制，且须随 manifest 发布）。

### 当前版本要点（便于翻译时对齐口径）

- 🔗「提取链接背后的原图」区块位于 🔍 智能图片提取 之后（第二个功能块）；
- 🎨 Color Extract：复制 HEX 色值对所有用户开放，无 Pro 门控（v1.0.7 权益统一后口径）；
- 📥 批量下载免费 30 张/次，Pro 无限；🤖 AI 标注免费月配额，Pro 不限；🦅 Eagle 导出免费 5 张，Pro 不限；实时监控为 Pro 功能；
- 🌍 语言清单以 `_locales/` 实际目录为准（含 हिन्दी，无 Polski）。
