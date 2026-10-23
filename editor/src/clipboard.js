import MarkdownIt from 'markdown-it'

export const ATTACHMENT_HOST = 'lightnote.attachments'

const mdParser = new MarkdownIt({ html: true, breaks: false })

// Math nodes serialize as empty elements, so emptiness checks must never treat them as blank.
const MATH_SELECTOR = '[data-type="inline-math"], [data-type="block-math"]'

export function escapeHtml(text) {
  return String(text || '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
}

export function isLikelyMath(str) {
  if (!str || typeof str !== 'string') return false
  const trimmed = str.trim()
  if (!trimmed) return false
  if (/^\d+(?:\.\d+)?$/.test(trimmed)) return false
  if (/\\(?:[a-zA-Z]+|[^\s])/.test(trimmed)) return true
  if (/[\\^_{}]/.test(trimmed)) return true
  if (/[=<>+\-*/]/.test(trimmed) && !/^\s*[一-龥a-zA-Z]+\s+[一-龥a-zA-Z]+\s*$/.test(trimmed)) return true
  if (/^[a-zA-Z]$/.test(trimmed)) return true
  if (/^[a-zA-Z]\([a-zA-Z0-9, ]+\)$/.test(trimmed)) return true
  return false
}

function extractExistingKatex(root) {
  for (const el of [...root.querySelectorAll('.katex')]) {
    const isBlock = Boolean(el.closest('.katex-display'))
    const annotation = el.querySelector('annotation[encoding="application/x-tex"]')
    const latex = annotation?.textContent?.trim()
    if (latex) {
      const target = isBlock ? el.closest('.katex-display') || el : el
      const replacement = document.createElement(isBlock ? 'div' : 'span')
      replacement.setAttribute('data-type', isBlock ? 'block-math' : 'inline-math')
      replacement.setAttribute('data-latex', latex)
      target.parentNode?.replaceChild(replacement, target)
    }
  }
}

function convertMathInTextNodes(root) {
  for (const span of [...root.querySelectorAll('span')]) {
    if (span.hasAttribute('data-type') || span.classList.contains('katex')) continue
    const text = span.textContent?.trim() || ''
    const match = text.match(/^\$([^$]+)\$$/)
    if (match && isLikelyMath(match[1])) {
      const inline = document.createElement('span')
      inline.setAttribute('data-type', 'inline-math')
      inline.setAttribute('data-latex', match[1].trim())
      span.parentNode?.replaceChild(inline, span)
    }
  }

  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null)
  const textNodes = []
  let currentNode
  while ((currentNode = walker.nextNode())) {
    const parentTag = currentNode.parentElement?.tagName?.toLowerCase()
    if (
      parentTag === 'script' ||
      parentTag === 'style' ||
      currentNode.parentElement?.closest('[data-type="inline-math"], [data-type="block-math"], .katex')
    ) {
      continue
    }
    if (currentNode.nodeValue && currentNode.nodeValue.includes('$')) {
      textNodes.push(currentNode)
    }
  }

  for (const node of textNodes) {
    const text = node.nodeValue || ''
    const mathPattern = /(\$\$[\s\S]+?\$\$|(?<!\$)\$[^\s$](?:[^$]*?[^\s$])?\$(?!\$))/g
    if (!mathPattern.test(text)) continue

    mathPattern.lastIndex = 0
    const fragment = document.createDocumentFragment()
    let lastIndex = 0
    let match

    while ((match = mathPattern.exec(text)) !== null) {
      const matchIndex = match.index
      if (matchIndex > lastIndex) {
        fragment.appendChild(document.createTextNode(text.slice(lastIndex, matchIndex)))
      }
      const raw = match[0]
      if (raw.startsWith('$$') && raw.endsWith('$$')) {
        const latex = raw.slice(2, -2).trim()
        const block = document.createElement('div')
        block.setAttribute('data-type', 'block-math')
        block.setAttribute('data-latex', latex)
        fragment.appendChild(block)
      } else {
        const latex = raw.slice(1, -1).trim()
        if (isLikelyMath(latex)) {
          const inline = document.createElement('span')
          inline.setAttribute('data-type', 'inline-math')
          inline.setAttribute('data-latex', latex)
          fragment.appendChild(inline)
        } else {
          fragment.appendChild(document.createTextNode(raw))
        }
      }
      lastIndex = matchIndex + raw.length
    }

    if (lastIndex < text.length) {
      fragment.appendChild(document.createTextNode(text.slice(lastIndex)))
    }

    node.parentNode?.replaceChild(fragment, node)
  }
}

function removeRedundantEmptyElements(root) {
  let changed = true
  while (changed) {
    changed = false
    for (const el of [...root.querySelectorAll('div, span')]) {
      if (
        el.matches(MATH_SELECTOR) ||
        el.querySelector(`img, ${MATH_SELECTOR}, hr, pre, table, p`)
      ) {
        continue
      }
      const text = el.textContent?.replace(/[\s ​]+/g, '') || ''
      if (text.length === 0) {
        el.remove()
        changed = true
      }
    }
  }

  for (const li of [...root.querySelectorAll('li')]) {
    if (
      !li.querySelector(`img, ${MATH_SELECTOR}`) &&
      (li.textContent?.replace(/[\s ​]+/g, '') || '').length === 0
    ) {
      li.remove()
      continue
    }
    const paragraphs = li.querySelectorAll(':scope > p')
    if (paragraphs.length === 1 && li.children.length === 1) {
      const p = paragraphs[0]
      while (p.firstChild) {
        li.insertBefore(p.firstChild, p)
      }
      p.remove()
    }
  }

  for (const br of [...root.querySelectorAll('br')]) {
    let next = br.nextSibling
    while (next && next.nodeType === 3 && !next.nodeValue.trim()) {
      next = next.nextSibling
    }
    if (next && next.nodeName === 'BR') {
      br.remove()
    }
  }
}

function mergeTitleAndUrlParagraphs(root) {
  const paragraphs = [...root.querySelectorAll(':scope > p, :scope > div')]
  if (paragraphs.length === 2) {
    const p1 = paragraphs[0]
    const p2 = paragraphs[1]
    const t1 = p1.textContent?.trim() || ''
    const t2 = p2.textContent?.trim() || ''
    const isUrl = str => /^https?:\/\/\S+$/i.test(str)
    if (t1 && !isUrl(t1) && isUrl(t2) && !p1.querySelector('img, pre, table') && !p2.querySelector('img, pre, table')) {
      const br = document.createElement('br')
      p1.appendChild(br)
      while (p2.firstChild) {
        p1.appendChild(p2.firstChild)
      }
      p2.remove()
    }
  }
}

function removeForeignImages(root) {
  for (const image of root.querySelectorAll('img')) {
    try {
      const url = new URL(image.getAttribute('src') || '')
      if (url.protocol !== 'https:' || url.hostname !== ATTACHMENT_HOST) image.remove()
    } catch {
      image.remove()
    }
  }
}

export function cleanAndConvertHtml(html) {
  const doc = new DOMParser().parseFromString(html || '<p></p>', 'text/html')
  extractExistingKatex(doc.body)
  convertMathInTextNodes(doc.body)
  removeRedundantEmptyElements(doc.body)
  mergeTitleAndUrlParagraphs(doc.body)
  removeForeignImages(doc.body)
  return doc.body.innerHTML || '<p></p>'
}

export function hasMarkdownSyntax(text) {
  if (!text) return false
  return (
    /(?:^|\n)#{1,6}\s+/.test(text) ||
    /(?:^|\n)\s*(?:[-*+]|\d+\.)\s+/.test(text) ||
    /\*\*[^*]+\*\*/.test(text) ||
    /\*[^*]+\*/.test(text) ||
    /`[^`]+`/.test(text) ||
    /```[\s\S]*?```/.test(text) ||
    /(?:^|\n)>\s+/.test(text) ||
    /\$\$[\s\S]+?\$\$/.test(text) ||
    /(?<!\$)\$[^\s$](?:[^$]*?[^\s$])?\$(?!\$)/.test(text) ||
    /\[[^\]]+\]\([^)]+\)/.test(text) ||
    /!\[[^\]]*\]\([^)]+\)/.test(text) ||
    /(?:^|\n)(?:---|\*\*\*)\s*(?:\n|$)/.test(text)
  )
}

export function markdownToCleanHtml(raw) {
  let md = (raw || '').replace(/\r\n/g, '\n').replace(/\r/g, '\n')
  md = md.replace(/\n{3,}/g, '\n\n')

  const listItemPattern = /(^|\n)(\s*(?:[-*+]|\d+\.)\s+[^\n]+)\n\s*\n(?=\s*(?:[-*+]|\d+\.)\s+)/g
  let prev
  do {
    prev = md
    md = md.replace(listItemPattern, '$1$2\n')
  } while (md !== prev)

  md = md.replace(/\$\$([\s\S]+?)\$\$/g, (_, latex) => {
    return `\n<div data-type="block-math" data-latex="${escapeHtml(latex.trim())}"></div>\n`
  })

  md = md.replace(/(?<!\$)\$([^\s$](?:[^$]*?[^\s$])?)\$(?!\$)/g, (fullMatch, latex) => {
    if (isLikelyMath(latex)) {
      return `<span data-type="inline-math" data-latex="${escapeHtml(latex.trim())}"></span>`
    }
    return fullMatch
  })

  const rawHtml = mdParser.render(md.trim())
  return cleanAndConvertHtml(rawHtml)
}

// ProseMirror marks the HTML it copies (LightNote's own included) with data-pm-slice, which
// records how deep the copied range sat. The native paste uses it to merge a copied phrase into
// the paragraph at the cursor, so such HTML only gets its images filtered.
function isEditorClipboardHtml(html) {
  return /\sdata-pm-slice=/.test(html || '')
}

export function transformPastedHtml(html) {
  if (!isEditorClipboardHtml(html)) return cleanAndConvertHtml(html)
  const doc = new DOMParser().parseFromString(html, 'text/html')
  removeForeignImages(doc.body)
  return doc.body.innerHTML
}

// Returns HTML for clipboard text that LightNote converts itself (a title + URL pair, Markdown,
// or $…$ formulas), or null to let ProseMirror paste the clipboard as it is.
export function convertPastedText(text, html) {
  if (!text || isEditorClipboardHtml(html)) return null

  // Prefer clipboard HTML so Markdown-like list text cannot discard embedded links or marks.
  if (html) return null

  const lines = text
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
  if (
    lines.length === 2 &&
    !/^https?:\/\//i.test(lines[0]) &&
    /^https?:\/\/\S+$/i.test(lines[1])
  ) {
    const title = escapeHtml(lines[0])
    const url = escapeHtml(lines[1])
    return `<p>${title}<br><a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a></p>`
  }

  if (hasMarkdownSyntax(text)) return markdownToCleanHtml(text)

  const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n').replace(/\n{3,}/g, '\n\n').trim()
  return normalized.includes('$') ? markdownToCleanHtml(normalized) : null
}

// Every paste goes through ProseMirror's own pipeline, which opens the pasted slice: a pasted
// phrase joins the paragraph at the cursor instead of being inserted as a separate paragraph
// that splits it (the stray line breaks around a copied word), and the paste is one undo step.
export function createPasteProps({ onImages }) {
  let replaying = false
  let plainTextPaste = false
  return {
    transformPastedHTML: html => transformPastedHtml(html),
    handleKeyDown(_view, event) {
      // Ctrl+Shift+V pastes plain text: no Markdown, link or formula conversion.
      plainTextPaste = (event.ctrlKey || event.metaKey) && event.shiftKey && event.key?.toLowerCase() === 'v'
      return false
    },
    handlePaste(view, event) {
      // view.pasteHTML below runs this handler again for the converted HTML.
      if (replaying) return false

      const images = [...(event.clipboardData?.items || [])]
        .filter(item => item.kind === 'file' && item.type.startsWith('image/'))
        .map(item => item.getAsFile())
        .filter(Boolean)
      if (images.length) {
        event.preventDefault()
        onImages(images, view.state.selection.from)
        return true
      }

      if (plainTextPaste) {
        plainTextPaste = false
        return false
      }

      const html = convertPastedText(
        event.clipboardData?.getData('text/plain'),
        event.clipboardData?.getData('text/html'),
      )
      if (html == null) return false

      event.preventDefault()
      replaying = true
      try {
        view.pasteHTML(html, event)
      } finally {
        replaying = false
      }
      return true
    },
  }
}
