// Share the command across the desktop and web editors without mixing Tiptap versions.
export function createCodeBlockSelection(Extension) {
  return Extension.create({
    name: 'codeBlockSelection',
    // Commands registered later override StarterKit's default command.
    priority: 50,
    addCommands() {
      return {
        toggleCodeBlock: attributes => ({ state, tr, dispatch, chain }) => {
          const { from, to } = state.selection
          const blocks = []
          let codeCoverage = 0
          state.doc.nodesBetween(from, to, (node, pos) => {
            if (node.type.name !== 'codeBlock') return
            blocks.push({ node, pos })
            codeCoverage += Math.min(to, pos + node.nodeSize) - Math.max(from, pos)
            return false
          })
          if (blocks.length && codeCoverage >= to - from) {
            if (!dispatch) return true
            // Each newline becomes a paragraph boundary; empty lines become empty paragraphs.
            for (const { node, pos } of blocks.reverse()) {
              const paragraphs = node.textContent.split(/\r\n|\r|\n/).map(line =>
                state.schema.nodes.paragraph.create(null, line ? state.schema.text(line) : null))
              tr.replaceWith(pos, pos + node.nodeSize, paragraphs)
            }
            return true
          }
          return chain()
          .toggleNode('codeBlock', 'paragraph', attributes)
          .command(({ tr, dispatch }) => {
            if (!dispatch) return true
            const joins = []
            let previousEnd = -1
            tr.doc.nodesBetween(tr.selection.from, tr.selection.to, (node, pos) => {
              if (node.type.name !== 'codeBlock') return
              if (pos === previousEnd) joins.push(pos)
              previousEnd = pos + node.nodeSize
              return false
            })
            // Work backwards so earlier boundaries stay at their original positions.
            for (const pos of joins.reverse()) {
              tr.insertText('\n', pos - 1)
              tr.join(pos + 1)
            }
            // Keep trailing separator lines outside the code block, while retaining internal blanks.
            const trailingBlanks = []
            tr.doc.nodesBetween(tr.selection.from, tr.selection.to, (node, pos) => {
              if (node.type.name !== 'codeBlock') return
              const suffix = node.textContent.match(/\n+$/)?.[0]
              if (suffix && suffix.length < node.textContent.length) {
                trailingBlanks.push({ node, pos, count: suffix.length })
              }
              return false
            })
            for (const { node, pos, count } of trailingBlanks.reverse()) {
              const text = node.textContent.slice(0, -count)
              const code = node.type.create(node.attrs, tr.doc.type.schema.text(text))
              const blanks = Array.from({ length: count }, () => tr.doc.type.schema.nodes.paragraph.create())
              tr.replaceWith(pos, pos + node.nodeSize, [code, ...blanks])
            }
            return true
          })
          .run()
        },
      }
    },
  })
}
