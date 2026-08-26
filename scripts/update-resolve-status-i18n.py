#!/usr/bin/env python3
"""One-shot i18n codemod: append the v1.1.0 round-3 gallery-resolve
per-link status tooltip keys to all 15 locales. Idempotent — a locale that
already has a key keeps its existing value.
"""
import json
from pathlib import Path

LOCALES_DIR = Path(__file__).resolve().parent.parent / '_locales'

# key -> {locale: message}
TRANSLATIONS = {
    'gallery_resolve_link_pending': {
        'en': 'Not resolved yet — click "Resolve originals" to try.',
        'zh_CN': '尚未解析——点击"解析原图"试试。',
        'zh_TW': '尚未解析——點擊「解析原圖」試試。',
        'ar': 'لم يتم التحليل بعد — انقر على "استخراج الصور الأصلية" للمحاولة.',
        'de': 'Noch nicht aufgelöst — klicke auf „Originalbilder auflösen“.',
        'es': 'Aún sin resolver: pulsa «Resolver originales» para intentarlo.',
        'fr': 'Pas encore résolu — cliquez sur « Résoudre les originaux ».',
        'hi': 'अभी तक हल नहीं हुआ — कोशिश करने के लिए "ओरिजिनल रिज़ॉल्व करें" पर क्लिक करें।',
        'it': 'Non ancora risolto: premi «Risolvi originali» per provare.',
        'ja': '未解決です——「オリジナルを解決」をクリックして試してください。',
        'ko': '아직 해결되지 않음 — "원본 해결"을 클릭해 시도해 보세요.',
        'nl': 'Nog niet opgelost — klik op "Originelen ophalen" om het te proberen.',
        'pt': 'Ainda não resolvido — clique em "Resolver originais" para tentar.',
        'ru': 'Ещё не разрешено — нажмите «Разрешить оригиналы», чтобы попробовать.',
        'th': 'ยังไม่ได้แก้ไข — คลิก "แก้ไขรูปต้นฉบับ" เพื่อลอง',
    },
    'gallery_resolve_link_resolved': {
        'en': 'Original image extracted from this page.',
        'zh_CN': '已解析出该页面的原图。',
        'zh_TW': '已解析出該頁面的原圖。',
        'ar': 'تم استخراج الصورة الأصلية من هذه الصفحة.',
        'de': 'Originalbild von dieser Seite extrahiert.',
        'es': 'Imagen original extraída de esta página.',
        'fr': 'Image originale extraite de cette page.',
        'hi': 'इस पेज से मूल चित्र निकाला गया।',
        'it': 'Immagine originale estratta da questa pagina.',
        'ja': 'このページからオリジナル画像を抽出しました。',
        'ko': '이 페이지에서 원본 이미지를 추출했습니다.',
        'nl': 'Originele afbeelding uit deze pagina gehaald.',
        'pt': 'Imagem original extraída desta página.',
        'ru': 'Оригинальное изображение извлечено с этой страницы.',
        'th': 'ดึงรูปต้นฉบับจากหน้านี้แล้ว',
    },
    'gallery_resolve_link_failed_blocked': {
        'en': 'Link skipped by the security policy (private or unsafe address).',
        'zh_CN': '链接被安全策略拦截（私有或不受信地址），未解析。',
        'zh_TW': '連結被安全策略攔截（私有或不受信位址），未解析。',
        'ar': 'تم تخطي الرابط بواسطة سياسة الأمان (عنوان خاص أو غير موثوق).',
        'de': 'Link wurde aus Sicherheitsgründen übersprungen (private oder unsichere Adresse).',
        'es': 'Enlace omitido por la política de seguridad (dirección privada o no segura).',
        'fr': 'Lien ignoré par la politique de sécurité (adresse privée ou non fiable).',
        'hi': 'सुरक्षा नीति द्वारा लिंक छोड़ा गया (निजी या असुरक्षित पता)।',
        'it': 'Link saltato dai criteri di sicurezza (indirizzo privato o non sicuro).',
        'ja': 'セキュリティポリシーによりリンクをスキップしました（プライベートまたは安全でないアドレス）。',
        'ko': '보안 정책에 따라 링크를 건너뛰었습니다(비공개 또는 안전하지 않은 주소).',
        'nl': 'Link overgeslagen door het beveiligingsbeleid (privé of onveilig adres).',
        'pt': 'Link ignorado pela política de segurança (endereço privado ou não seguro).',
        'ru': 'Ссылка пропущена политикой безопасности (приватный или небезопасный адрес).',
        'th': 'ข้ามลิงก์ตามนโยบายความปลอดภัย (ที่อยู่ส่วนตัวหรือไม่ปลอดภัย)',
    },
    'gallery_resolve_link_failed_http_error': {
        'en': 'Page unreachable — it may require login or has expired.',
        'zh_CN': '页面无法访问——可能需要登录或已失效。',
        'zh_TW': '頁面無法存取——可能需要登入或已失效。',
        'ar': 'تعذر الوصول إلى الصفحة — قد تتطلب تسجيل الدخول أو انتهت صلاحيتها.',
        'de': 'Seite nicht erreichbar — eventuell Anmeldung erforderlich oder abgelaufen.',
        'es': 'No se puede acceder a la página: puede requerir inicio de sesión o haber caducado.',
        'fr': 'Page inaccessible — connexion requise ou lien expiré.',
        'hi': 'पेज उपलब्ध नहीं है — इसमें लॉगिन की आवश्यकता हो सकती है या समाप्त हो चुका है।',
        'it': 'Pagina non raggiungibile: potrebbe richiedere l\'accesso o essere scaduta.',
        'ja': 'ページにアクセスできません——ログインが必要か、期限切れの可能性があります。',
        'ko': '페이지에 접근할 수 없습니다 — 로그인이 필요하거나 만료되었을 수 있습니다.',
        'nl': 'Pagina niet bereikbaar — mogelijk aanmelding vereist of verlopen.',
        'pt': 'Página inacessível — pode exigir login ou ter expirado.',
        'ru': 'Страница недоступна — может требовать входа или уже не существует.',
        'th': 'เข้าถึงหน้านี้ไม่ได้ — อาจต้องเข้าสู่ระบบหรือหมดอายุแล้ว',
    },
    'gallery_resolve_link_failed_non_html': {
        'en': 'Link target is not a web page, nothing to resolve.',
        'zh_CN': '链接目标不是网页，无法解析。',
        'zh_TW': '連結目標不是網頁，無法解析。',
        'ar': 'هدف الرابط ليس صفحة ويب، فلا يمكن تحليله.',
        'de': 'Das Linkziel ist keine Webseite — nichts aufzulösen.',
        'es': 'El destino del enlace no es una página web: no hay nada que resolver.',
        'fr': 'La cible du lien n\'est pas une page web : rien à résoudre.',
        'hi': 'लिंक लक्ष्य वेब पेज नहीं है, कुछ भी हल नहीं करने को है।',
        'it': 'La destinazione del link non è una pagina web: niente da risolvere.',
        'ja': 'リンク先はウェブページではないため、解決できるものがありません。',
        'ko': '링크 대상이 웹 페이지가 아니어서 해결할 수 없습니다.',
        'nl': 'Het linkdoel is geen webpagina — niets op te lossen.',
        'pt': 'O destino do link não é uma página web: nada a resolver.',
        'ru': 'Цель ссылки — не веб-страница, разрешать нечего.',
        'th': 'เป้าหมายของลิงก์ไม่ใช่หน้าเว็บ จึงแก้ไขไม่ได้',
    },
    'gallery_resolve_link_failed_no_meta_image': {
        'en': 'Page loaded, but it advertises no extractable original image.',
        'zh_CN': '页面已加载，但未声明可提取的原图。',
        'zh_TW': '頁面已載入，但未宣告可擷取的原圖。',
        'ar': 'تم تحميل الصفحة، لكنها لا تعلن عن صورة أصلية قابلة للاستخراج.',
        'de': 'Seite geladen, aber sie enthält kein extrahierbares Originalbild.',
        'es': 'La página cargó, pero no declara ninguna imagen original extraíble.',
        'fr': 'Page chargée, mais aucune image originale extractible n\'y est déclarée.',
        'hi': 'पेज लोड हो गया, लेकिन इसमें कोई निकालने योग्य मूल चित्र घोषित नहीं है।',
        'it': 'Pagina caricata, ma non dichiara alcuna immagine originale estraibile.',
        'ja': 'ページは読み込まれましたが、抽出可能なオリジナル画像が宣言されていません。',
        'ko': '페이지가 로드되었지만 추출 가능한 원본 이미지가 없습니다.',
        'nl': 'Pagina geladen, maar meldt geen extraheerbaar origineel afbeelding.',
        'pt': 'A página carregou, mas não declara nenhuma imagem original extraível.',
        'ru': 'Страница загрузилась, но не объявляет извлекаемое оригинальное изображение.',
        'th': 'หน้าโหลดแล้ว แต่ไม่มีรูปต้นฉบับที่ดึงได้ระบุไว้',
    },
    'gallery_resolve_link_failed_network_error': {
        'en': 'Network error or timeout while fetching the page.',
        'zh_CN': '获取页面时发生网络错误或超时。',
        'zh_TW': '取得頁面時發生網路錯誤或逾時。',
        'ar': 'حدث خطأ في الشبكة أو انتهت المهلة أثناء جلب الصفحة.',
        'de': 'Netzwerkfehler oder Zeitüberschreitung beim Laden der Seite.',
        'es': 'Error de red o tiempo de espera agotado al obtener la página.',
        'fr': 'Erreur réseau ou délai dépassé lors de la récupération de la page.',
        'hi': 'पेज लाते समय नेटवर्क त्रुटि या टाइमआउट हुआ।',
        'it': 'Errore di rete o timeout durante il recupero della pagina.',
        'ja': 'ページの取得中にネットワークエラーまたはタイムアウトが発生しました。',
        'ko': '페이지를 가져오는 중 네트워크 오류 또는 시간 초과가 발생했습니다.',
        'nl': 'Netwerkfout of time-out bij het ophalen van de pagina.',
        'pt': 'Erro de rede ou tempo limite ao buscar a página.',
        'ru': 'Сетевая ошибка или тайм-аут при загрузке страницы.',
        'th': 'เกิดข้อผิดพลาดของเครือข่ายหรือหมดเวลาระหว่างดึงหน้าเว็บ',
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
