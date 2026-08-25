#!/usr/bin/env python3
"""One-off (smoke-feedback round 2): clarify link-source badges and add a
duplicate-injection toast.

- UPDATE  badge_link_image     "Original"    -> "Linked original"  (zh: 链接原图)
- UPDATE  badge_link_resolved  "Resolved"    -> "From link"        (zh: 来自链接)
  Smoke testers read "已解析/Resolved" as a status with no clue where the
  image came from; the new copy states the SOURCE, and tooltips (below)
  carry the technical detail.
- ADD     badge_link_image_title    (tooltip)
- ADD     badge_link_resolved_title (tooltip)
- ADD     toast_context_item_duplicate  — shown when right-clicking an image
  that is already in the results (dedup hit), instead of silence.

New keys are appended at the end; updated keys keep their original
position. Format (indent=2, trailing newline) is preserved.
"""
import json
import os

ROOT = os.path.join(os.path.dirname(__file__), '..', '_locales')

# locale -> (badge_link_image, badge_link_resolved,
#            badge_link_image_title, badge_link_resolved_title,
#            toast_context_item_duplicate)
TRANSLATIONS = {
    'en': (
        "Linked original",
        "From link",
        "The link behind this thumbnail points directly to this larger image",
        "Added by resolving the linked page (not displayed on the page itself)",
        "Already in the results — not added again",
    ),
    'zh_CN': (
        "链接原图",
        "来自链接",
        "该缩略图的链接直接指向这张大图",
        "通过解析链接页面添加，不在当前页面中显示",
        "图片已在结果中，未重复添加",
    ),
    'zh_TW': (
        "連結原圖",
        "來自連結",
        "該縮圖的連結直接指向這張大圖",
        "透過解析連結頁面新增，不在目前頁面中顯示",
        "圖片已在結果中，未重複新增",
    ),
    'ja': (
        "リンク先の原画",
        "リンクから取得",
        "このサムネイルのリンク先がこの大きな画像を直接指しています",
        "リンク先ページの解析によって追加されました（ページ上には表示されていません）",
        "すでに結果に含まれているため、重複追加はしません",
    ),
    'ko': (
        "링크 원본",
        "링크에서 가져옴",
        "이 섬네일의 링크가 이 큰 이미지를 직접 가리킵니다",
        "링크된 페이지를 해석하여 추가되었습니다 (페이지에는 표시되지 않음)",
        "이미 결과에 있어 중복 추가하지 않았습니다",
    ),
    'de': (
        "Verlinktes Original",
        "Aus Link",
        "Der Link hinter dieser Miniatur zeigt direkt auf dieses größere Bild",
        "Durch Auflösen der verlinkten Seite hinzugefügt (nicht auf der Seite selbst sichtbar)",
        "Bereits in den Ergebnissen – nicht erneut hinzugefügt",
    ),
    'fr': (
        "Original lié",
        "Depuis le lien",
        "Le lien derrière cette vignette pointe directement vers cette image plus grande",
        "Ajouté en résolvant la page liée (non affiché sur la page elle-même)",
        "Déjà dans les résultats — pas ajouté à nouveau",
    ),
    'es': (
        "Original enlazado",
        "Del enlace",
        "El enlace detrás de esta miniatura apunta directamente a esta imagen más grande",
        "Añadido al resolver la página enlazada (no se muestra en la propia página)",
        "Ya está en los resultados; no se añade otra vez",
    ),
    'it': (
        "Originale collegato",
        "Dal link",
        "Il collegamento dietro questa miniatura punta direttamente a questa immagine più grande",
        "Aggiunto risolvendo la pagina collegata (non mostrato nella pagina stessa)",
        "Già presente nei risultati — non aggiunto di nuovo",
    ),
    'pt': (
        "Original vinculado",
        "Do link",
        "O link atrás desta miniatura aponta diretmente para esta imagem maior",
        "Adicionado ao resolver a página vinculada (não exibido na própria página)",
        "Já está nos resultados — não adicionado novamente",
    ),
    'ru': (
        "Оригинал по ссылке",
        "Из ссылки",
        "Ссылка позади этой миниатюры ведёт напрямую на это увеличенное изображение",
        "Добавлено при разрешении связанной страницы (не отображается на самой странице)",
        "Уже есть в результатах — повторно не добавлено",
    ),
    'ar': (
        "الأصل المرتبط",
        "من رابط",
        "الرابط خلف هذه الصورة المصغّرة يشير مباشرة إلى هذه الصورة الأكبر",
        "أُضيفت عن طريق تحليل الصفحة المرتبطة (لا تظهر في الصفحة نفسها)",
        "الصورة موجودة بالفعل في النتائج — لم تتم إضافتها مرة أخرى",
    ),
    'hi': (
        "लिंक किया ओरिजिनल",
        "लिंक से",
        "इस थंबनेल के पीछे का लिंक सीधे इस बड़ी छवि पर जाता है",
        "लिंक किए पृष्ठ को रिज़ॉल्व करके जोड़ा गया (पृष्ठ पर स्वयं प्रदर्शित नहीं)",
        "परिणामों में पहले से मौजूद है — दोबारा नहीं जोड़ा गया",
    ),
    'th': (
        "ต้นฉบับจากลิงก์",
        "จากลิงก์",
        "ลิงก์ที่อยู่หลังรูปขนาดย่อนี้ชี้ตรงไปยังรูปขนาดใหญ่นี้",
        "เพิ่มโดยแก้ไขหน้าที่ลิงก์ไว้ (ไม่ได้แสดงบนหน้าเว็บ)",
        "มีในผลลัพธ์อยู่แล้ว — ไม่ได้เพิ่มซ้ำ",
    ),
    'nl': (
        "Gekoppeld origineel",
        "Van link",
        "De link achter deze miniatuur wijst direct naar deze grotere afbeelding",
        "Toegevoegd door de gelinkte pagina op te lossen (niet zichtbaar op de pagina zelf)",
        "Staat al in de resultaten — niet opnieuw toegevoegd",
    ),
}

UPDATE_KEYS = ['badge_link_image', 'badge_link_resolved']
NEW_KEYS = [
    'badge_link_image_title',
    'badge_link_resolved_title',
    'toast_context_item_duplicate',
]

for locale, values in TRANSLATIONS.items():
    path = os.path.join(ROOT, locale, 'messages.json')
    with open(path, encoding='utf-8') as f:
        catalog = json.load(f)
    changed = []
    for key, value in zip(UPDATE_KEYS, values[:2]):
        if catalog.get(key, {}).get('message') != value:
            entry = catalog.get(key, {})
            entry['message'] = value
            catalog[key] = entry
            changed.append(f'~{key}')
    for key, value in zip(NEW_KEYS, values[2:]):
        if key not in catalog:
            catalog[key] = {'message': value}
            changed.append(f'+{key}')
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(catalog, f, ensure_ascii=False, indent=2)
        f.write('\n')
    print(f'{locale}: {changed if changed else "nothing to do"}')
