/**
 * 命名规则引擎
 * 处理文件名模板和变量替换
 */

/**
 * 从 URL 提取原始文件名
 * @param {string} url - 图片 URL
 * @returns {string} 原始文件名（不含扩展名）
 */
function getOriginalName(url) {
  try {
    const urlObj = new URL(url);
    const pathname = urlObj.pathname;
    const filename = pathname.split('/').pop();
    
    if (!filename) {
      return 'image';
    }
    
    const nameWithoutExt = filename.replace(/\.[^.]+$/, '');
    return nameWithoutExt || 'image';
  } catch {
    return 'image';
  }
}

/**
 * 清理文件名
 * @param {string} name - 原始文件名
 * @returns {string} 清理后的文件名
 */
function sanitizeFilename(name) {
  if (!name || typeof name !== 'string') {
    return 'image';
  }
  
  let cleaned = name;
  
  cleaned = cleaned.replace(/[\/\\:*?"<>|]/g, '_');
  cleaned = cleaned.trim();
  cleaned = cleaned.replace(/^\.+|\.+$/g, '');
  
  if (cleaned.length > 200) {
    cleaned = cleaned.substring(0, 200);
  }
  
  return cleaned || 'image';
}

/**
 * 构建变量对象
 * @param {Object} options - 选项对象
 * @param {string} options.url - 图片 URL
 * @param {number} options.index - 图片索引
 * @param {string} options.pageTitle - 页面标题
 * @param {string} options.pageDomain - 页面域名
 * @param {number} options.width - 图片宽度
 * @param {number} options.height - 图片高度
 * @param {string} options.format - 图片格式
 * @param {string} options.date - 当前日期 (YYYY-MM-DD)
 * @param {number} options.timestamp - 当前时间戳
 * @returns {Object} 变量对象
 */
function buildVariables(options) {
  const {
    url = '',
    index = 0,
    pageTitle = '',
    pageDomain = '',
    width = 0,
    height = 0,
    format = '',
    date = '',
    timestamp = 0
  } = options;
  
  const originalName = getOriginalName(url);
  
  return {
    index: String(index),
    original: sanitizeFilename(originalName),
    pageTitle: sanitizeFilename(pageTitle),
    pageDomain: pageDomain.replace(/^[^.]+\./, ''),
    width: String(width),
    height: String(height),
    format: format || 'png',
    date: date,
    timestamp: String(timestamp),
    year: date ? date.substring(0, 4) : '',
    month: date ? date.substring(5, 7) : '',
    day: date ? date.substring(8, 10) : ''
  };
}

/**
 * 应用命名模板
 * @param {string} template - 模板字符串，如 'img_{index}_{original}.{format}'
 * @param {Object} variables - 变量对象
 * @returns {string} 替换后的文件名
 */
function applyNamingTemplate(template, variables) {
  if (!template || typeof template !== 'string') {
    return 'image.png';
  }
  
  let result = template;
  
  for (const [key, value] of Object.entries(variables)) {
    const placeholder = `{${key}}`;
    const regex = new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g');
    result = result.replace(regex, String(value || ''));
  }
  
  result = sanitizeFilename(result);
  
  if (!result) {
    return 'image.png';
  }
  
  if (!result.includes('.')) {
    result += '.png';
  }
  
  return result;
}
