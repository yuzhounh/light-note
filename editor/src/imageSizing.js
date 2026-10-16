const PRESETS = new Set(['25%', '50%', '75%', '100%'])
const positive = value => Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : 0

export function defaultImageWidth(pixelWidth, pixelHeight, pixelRatio = 1) {
  const width = positive(pixelWidth)
  const height = positive(pixelHeight)
  const limit = width && height / width >= 1.6 ? 360 : 1080
  return width ? Math.max(1, Math.floor(Math.min(limit, width / (positive(pixelRatio) || 1)))) : limit
}

export function initialImageSize(pixelWidth, pixelHeight, pixelRatio = 1) {
  const baseWidth = defaultImageWidth(pixelWidth, pixelHeight, pixelRatio)
  return { baseWidth, width: `${baseWidth}px`, widthPreset: '100%', widthMode: 'default',
    pixelWidth: positive(pixelWidth) || null, pixelHeight: positive(pixelHeight) || null }
}

export function imageLayout(attrs, naturalWidth = 0, naturalHeight = 0, pixelRatio = 1) {
  const legacyPercent = typeof attrs.width === 'string' && /^\d+(?:\.\d+)?%$/.test(attrs.width) ? attrs.width : null
  const storedBase = positive(attrs.baseWidth)
  const storedWidth = typeof attrs.width === 'string' && /^\d+(?:\.\d+)?px$/.test(attrs.width)
    ? parseFloat(attrs.width) : positive(attrs.width)
  const isDefault = attrs.widthMode === 'default' || (attrs.widthMode !== 'manual' && (
    attrs.width == null || legacyPercent === '100%' ||
    (attrs.widthPreset === '100%' && storedBase > 0 && storedWidth === storedBase)))
  const naturalBase = defaultImageWidth(attrs.pixelWidth || naturalWidth, attrs.pixelHeight || naturalHeight, pixelRatio)
  const baseWidth = isDefault ? naturalBase : storedBase || naturalBase
  const widthPreset = PRESETS.has(attrs.widthPreset) ? attrs.widthPreset
    : PRESETS.has(legacyPercent) ? legacyPercent : attrs.width == null ? '100%' : null
  const width = isDefault ? `${baseWidth}px` : legacyPercent ? `${baseWidth * parseFloat(legacyPercent) / 100}px`
    : positive(attrs.width) ? `${Number(attrs.width)}px` : attrs.width || `${baseWidth}px`
  return { baseWidth, width, widthPreset, isDefault }
}

export function presetImageSize(baseWidth, widthPreset) {
  return { baseWidth, widthPreset, widthMode: 'manual', width: `${Math.round(baseWidth * parseFloat(widthPreset) / 100)}px` }
}

// These attributes travel with both HTML and JSON across the desktop and web editors.
export function imageSizingAttributes() {
  return Object.fromEntries([
    ['baseWidth', 'data-image-base-width'], ['pixelWidth', 'data-image-pixel-width'],
    ['pixelHeight', 'data-image-pixel-height'], ['widthPreset', 'data-image-width-preset'],
    ['widthMode', 'data-image-width-mode'],
  ].map(([name, attribute]) => [name, {
    default: null,
    parseHTML: element => name === 'widthPreset'
      ? (PRESETS.has(element.getAttribute(attribute)) ? element.getAttribute(attribute) : null)
      : name === 'widthMode'
        ? (['default', 'manual'].includes(element.getAttribute(attribute)) ? element.getAttribute(attribute) : null)
        : positive(element.getAttribute(attribute)) || null,
    renderHTML: attrs => attrs[name] ? { [attribute]: attrs[name] } : {},
  }]))
}
