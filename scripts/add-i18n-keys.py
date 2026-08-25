#!/usr/bin/env python3
"""One-off: add 4 new i18n keys (gallery-resolve UX + not-on-page toast)
to every _locales/*/messages.json. Keys are appended at the end; existing
content/format (indent=2, trailing newline) is preserved."""
import json
import os

ROOT = os.path.join(os.path.dirname(__file__), '..', '_locales')

# locale -> (gallery_resolve_bar_hint, gallery_resolve_toggle_title,
#            gallery_resolve_links_more, toast_not_on_page)
TRANSLATIONS = {
    'en': (
        "These thumbnails link to detail pages — resolving opens each page and adds its main image to the results.",
        "Show / hide gallery links",
        "…and {count} more",
        "This image came from a link and isn't displayed on the page itself",
    ),
    'zh_CN': (
        "这些缩略图指向详情页——点击解析会逐页获取其中的原图并加入结果。",
        "展开 / 收起图库链接",
        "…还有 {count} 个",
        "该图片来自链接解析，不在页面中显示",
    ),
    'zh_TW': (
        "這些縮圖指向詳細頁——點擊解析會逐頁取得其中的原圖並加入結果。",
        "展開 / 收合圖庫連結",
        "…還有 {count} 個",
        "該圖片來自連結解析，不在頁面中顯示",
    ),
    'ja': (
        "これらのサムネイルは詳細ページへリンクしています。解析すると各ページのメイン画像を結果に追加します。",
        "ギャラリーリンクの表示 / 非表示",
        "…ほか{count}件",
        "この画像はリンクから取得したもので、ページ上には表示されていません",
    ),
    'ko': (
        "이 섬네일은 상세 페이지로 연결됩니다. 해석을 실행하면 각 페이지의 대표 이미지를 결과에 추가합니다.",
        "갤러리 링크 표시 / 숨기기",
        "…외 {count}개",
        "이 이미지는 링크에서 가져온 것으로 페이지에 표시되어 있지 않습니다",
    ),
    'de': (
        "Diese Miniaturen verlinken auf Detailseiten – beim Auflösen wird das Hauptbild jeder Seite zu den Ergebnissen hinzugefügt.",
        "Galerie-Links ein- / ausblenden",
        "…und {count} weitere",
        "Dieses Bild stammt aus einem Link und wird nicht auf der Seite selbst angezeigt",
    ),
    'fr': (
        "Ces vignettes pointent vers des pages de détail — la résolution ouvre chaque page et ajoute son image principale aux résultats.",
        "Afficher / masquer les liens de galerie",
        "…et {count} autres",
        "Cette image provient d'un lien et n'est pas affichée sur la page elle-même",
    ),
    'es': (
        "Estas miniaturas enlazan a páginas de detalle; resolver abre cada página y añade su imagen principal a los resultados.",
        "Mostrar / ocultar enlaces de galería",
        "…y {count} más",
        "Esta imagen proviene de un enlace y no se muestra en la propia página",
    ),
    'it': (
        "Queste miniature portano a pagine di dettaglio; la risoluzione apre ogni pagina e aggiunge la sua immagine principale ai risultati.",
        "Mostra / nascondi i link della galleria",
        "…e altri {count}",
        "Questa immagine proviene da un link e non è mostrata nella pagina stessa",
    ),
    'pt': (
        "Estas miniaturas apontam para páginas de detalhe; resolver abre cada página e adiciona a sua imagem principal aos resultados.",
        "Mostrar / ocultar links da galeria",
        "…e mais {count}",
        "Esta imagem veio de um link e não é exibida na própria página",
    ),
    'ru': (
        "Эти миниатюры ведут на страницы-детали; разрешение открывает каждую страницу и добавляет её главное изображение в результаты.",
        "Показать / скрыть ссылки галереи",
        "…ещё {count}",
        "Это изображение получено из ссылки и не отображается на самой странице",
    ),
    'ar': (
        "تربط هذه الصور المصغّرة بصفحات تفاصيل؛ يقوم التحليل بفتح كل صفحة وإضافة صورتها الرئيسية إلى النتائج.",
        "إظهار / إخفاء روابط المعرض",
        "…و{count} أخرى",
        "هذه الصورة مأخوذة من رابط ولا تظهر في الصفحة نفسها",
    ),
    'hi': (
        "ये थंबनेल विवरण पृष्ठों से जुड़े हैं — रिज़ॉल्व करने पर हर पृष्ठ खुलता है और उसकी मुख्य छवि परिणामों में जुड़ जाती है।",
        "गैलरी लिंक दिखाएँ / छिपाएँ",
        "…और {count} अन्य",
        "यह छवि किसी लिंक से ली गई है और पृष्ठ पर स्वयं दिखाई नहीं देती",
    ),
    'th': (
        "รูปขนาดย่อเหล่านี้ลิงก์ไปยังหน้ารายละเอียด การแก้ไขจะเปิดแต่ละหน้าและเพิ่มรูปหลักลงในผลลัพธ์",
        "แสดง / ซ่อนลิงก์แกลเลอรี",
        "…และอีก {count} รายการ",
        "รูปนี้มาจากลิงก์และไม่ได้แสดงบนหน้าเว็บ",
    ),
    'nl': (
        "Deze miniaturen linken naar detailpagina's; bij het oplossen wordt elke pagina geopend en de hoofdafbeelding aan de resultaten toegevoegd.",
        "Galerij-links tonen / verbergen",
        "…en nog {count}",
        "Deze afbeelding komt uit een link en wordt niet op de pagina zelf weergegeven",
    ),
}

KEYS = ['gallery_resolve_bar_hint', 'gallery_resolve_toggle_title',
        'gallery_resolve_links_more', 'toast_not_on_page']

for locale, values in TRANSLATIONS.items():
    path = os.path.join(ROOT, locale, 'messages.json')
    with open(path, encoding='utf-8') as f:
        catalog = json.load(f)
    added = []
    for key, value in zip(KEYS, values):
        if key not in catalog:
            catalog[key] = {'message': value}
            added.append(key)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f'{locale}: added {added if added else "nothing (already present)"}')
