#!/usr/bin/env python3
"""One-shot i18n codemod: add the link-resolve quota/upsell keys to all 15
locales — the QuotaDisplay row label plus the two success-toast variants that
surface the free monthly budget after each resolve (soft upsell touchpoint).
Idempotent — a locale that already has a key keeps its existing value.
"""
import json
from pathlib import Path

LOCALES_DIR = Path(__file__).resolve().parent.parent / '_locales'

# key -> {locale: message}
TRANSLATIONS = {
    'quota_link_resolve': {
        'en': 'Link Resolve',
        'zh_CN': '链接解析',
        'zh_TW': '連結解析',
        'ar': 'تحليل الروابط',
        'de': 'Link-Auflösung',
        'es': 'Resolución de enlaces',
        'fr': 'Résolution de liens',
        'hi': 'लिंक रिज़ॉल्व',
        'it': 'Risoluzione link',
        'ja': 'リンク解決',
        'ko': '링크 리졸브',
        'nl': 'Link-resolutie',
        'pt': 'Resolução de links',
        'ru': 'Разбор ссылок',
        'th': 'แก้ไขลิงก์',
    },
    'toast_gallery_resolved_remaining': {
        'en': 'Added {images} original images · {remaining} link resolves left this month',
        'zh_CN': '已添加 {images} 张原图 · 本月还剩 {remaining} 次链接解析',
        'zh_TW': '已新增 {images} 張原圖 · 本月還剩 {remaining} 次連結解析',
        'ar': 'تمت إضافة {images} صورة أصلية · متبقٍ {remaining} تحليل روابط هذا الشهر',
        'de': '{images} Originalbilder hinzugefügt · noch {remaining} Link-Auflösungen diesen Monat',
        'es': 'Se añadieron {images} imágenes originales · quedan {remaining} resoluciones este mes',
        'fr': '{images} images originales ajoutées · {remaining} résolutions restantes ce mois-ci',
        'hi': '{images} मूल चित्र जोड़े गए · इस माह {remaining} लिंक रिज़ॉल्व शेष',
        'it': 'Aggiunte {images} immagini originali · restano {remaining} risoluzioni questo mese',
        'ja': '元画像 {images} 枚を追加 · 今月のリンク解決はあと {remaining} 回',
        'ko': '원본 이미지 {images}장 추가 · 이번 달 링크 리졸브 {remaining}회 남음',
        'nl': '{images} originele afbeeldingen toegevoegd · nog {remaining} link-resoluties deze maand',
        'pt': '{images} imagens originais adicionadas · restam {remaining} resoluções neste mês',
        'ru': 'Добавлено оригиналов: {images} · осталось разборов ссылок в этом месяце: {remaining}',
        'th': 'เพิ่มภาพต้นฉบับ {images} ภาพ · เหลือการแก้ไขลิงก์อีก {remaining} ครั้งในเดือนนี้',
    },
    'toast_gallery_resolved_last': {
        'en': 'Added {images} original images · monthly link-resolve quota used up — Pro is unlimited',
        'zh_CN': '已添加 {images} 张原图 · 本月链接解析次数已用完，升级 Pro 无限解析',
        'zh_TW': '已新增 {images} 張原圖 · 本月連結解析次數已用完，升級 Pro 可無限解析',
        'ar': 'تمت إضافة {images} صورة أصلية · نفدت حصة تحليل الروابط لهذا الشهر — Pro بلا حدود',
        'de': '{images} Originalbilder hinzugefügt · Monatskontingent für Link-Auflösung aufgebraucht — Pro ist unbegrenzt',
        'es': 'Se añadieron {images} imágenes originales · cuota mensual de resolución agotada — Pro es ilimitado',
        'fr': '{images} images originales ajoutées · quota mensuel de résolution épuisé — Pro est illimité',
        'hi': '{images} मूल चित्र जोड़े गए · इस माह का लिंक रिज़ॉल्व कोटा समाप्त — Pro असीमित है',
        'it': 'Aggiunte {images} immagini originali · quota mensile di risoluzione esaurita — Pro è illimitato',
        'ja': '元画像 {images} 枚を追加 · 今月のリンク解決回数を使い切りました。Pro なら無制限です',
        'ko': '원본 이미지 {images}장 추가 · 이번 달 링크 리졸브 횟수를 모두 사용했습니다. Pro는 무제한',
        'nl': '{images} originele afbeeldingen toegevoegd · maandelijks quotum voor link-resolutie op — Pro is onbeperkt',
        'pt': '{images} imagens originais adicionadas · cota mensal de resolução esgotada — Pro é ilimitado',
        'ru': 'Добавлено оригиналов: {images} · месячный лимит разбора ссылок исчерпан — в Pro без ограничений',
        'th': 'เพิ่มภาพต้นฉบับ {images} ภาพ · ใช้โควต้าแก้ไขลิงก์ประจำเดือนหมดแล้ว — Pro ไม่จำกัด',
    },
}

for locale_dir in sorted(LOCALES_DIR.iterdir()):
    if not locale_dir.is_dir():
        continue
    msg_path = locale_dir / 'messages.json'
    if not msg_path.exists():
        continue
    locale = locale_dir.name
    data = json.loads(msg_path.read_text(encoding='utf-8'))
    added = 0
    for key, per_locale in TRANSLATIONS.items():
        if key in data:
            continue
        data[key] = {'message': per_locale.get(locale, per_locale['en'])}
        added += 1
    if added:
        msg_path.write_text(
            json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8'
        )
    print(f'{locale}: +{added} keys')
