import { Extension } from '@tiptap/core'
import { Plugin, PluginKey } from '@tiptap/pm/state'

// “Markdown 自动排版”开关：关闭时在输入规则之前接管文字输入，直接按原样插入，
// 因此 `1. `、`# `、`**粗体**`、`$公式$` 等规则都不会触发；工具栏与快捷键不受影响。
export const MarkdownGate = Extension.create({
  name: 'markdownGate',
  priority: 1000,
  addOptions() {
    return { isEnabled: () => true }
  },
  addProseMirrorPlugins() {
    const { isEnabled } = this.options
    return [
      new Plugin({
        key: new PluginKey('markdownGate'),
        props: {
          handleTextInput(view, from, to, text) {
            if (isEnabled()) return false
            view.dispatch(view.state.tr.insertText(text, from, to).scrollIntoView())
            return true
          },
        },
      }),
    ]
  },
})
