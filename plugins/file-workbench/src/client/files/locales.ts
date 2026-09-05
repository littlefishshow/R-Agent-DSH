/** `fileWorkspace` namespace dictionaries for the file panel, sidebar toggle, and sub-windows. */

/** Dictionary namespace owned by this plugin. */
export const NS = 'fileWorkspace'

/** The file-workspace dictionary key set (source of truth for both locales). */
export type FileWorkspaceKey =
  | 'mode.chat'
  | 'mode.files'
  | 'panel.title'
  | 'panel.empty'
  | 'panel.addFolder'
  | 'panel.removeFolder'
  | 'panel.loading'
  | 'panel.error'
  | 'tree.newFile'
  | 'tree.newFolder'
  | 'tree.rename'
  | 'tree.delete'
  | 'tree.copy'
  | 'tree.paste'
  | 'tree.deleteConfirm'
  | 'tree.namePrompt'
  | 'doc.edit'
  | 'doc.empty'
  | 'doc.openFiles'
  | 'doc.close'
  | 'doc.closeDirty'
  | 'doc.fontSize'
  | 'doc.preview'
  | 'doc.save'
  | 'doc.saving'
  | 'doc.saved'
  | 'doc.dirty'
  | 'doc.unsupported'
  | 'selection.modify'
  | 'selection.ask'
  | 'selection.explain'
  | 'selection.summarize'
  | 'selection.openConversation'
  | 'selection.sourceNotFound'
  | 'window.chat'
  | 'window.trajectory'
  | 'window.selection'
  | 'window.context'
  | 'window.tool'
  | 'window.minimize'
  | 'window.fullscreen'
  | 'window.restore'
  | 'window.resize'
  | 'window.close'
  | 'window.hideDock'
  | 'window.accept'
  | 'window.invalidReplacement'
  | 'window.sourceChanged'
  | 'window.creating'
  | 'window.deleting'
  | 'window.thinking'
  | 'window.send'
  | 'window.stop'
  | 'window.sendPlaceholder'
  | 'window.askPlaceholder'
  | 'window.modifyPlaceholder'
  | 'window.acceptConfirm'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** The file panel, sidebar toggle, tree menu, editor, selection, and sub-window strings. */
    'fileWorkspace': FileWorkspaceKey
  }
}

/** Simplified Chinese dictionary (the key-set source of truth). */
export const zh: Record<FileWorkspaceKey, string> = {
  'mode.chat': '对话',
  'mode.files': '文件',
  'panel.title': '工作区',
  'panel.empty': '尚未添加工作区。点击「添加工作区」选择一个目录。',
  'panel.addFolder': '添加工作区',
  'panel.removeFolder': '移除工作区',
  'panel.loading': '加载中…',
  'panel.error': '出错：',
  'tree.newFile': '新建文件',
  'tree.newFolder': '新建文件夹',
  'tree.rename': '重命名',
  'tree.delete': '删除',
  'tree.copy': '复制',
  'tree.paste': '粘贴',
  'tree.deleteConfirm': '确定删除「{name}」？此操作不可撤销。',
  'tree.namePrompt': '名称：',
  'doc.edit': '编辑',
  'doc.empty': '请从左侧文件树选择一个文件。',
  'doc.openFiles': '已打开文件',
  'doc.close': '关闭 {name}',
  'doc.closeDirty': '“{name}”有未保存修改。仍要关闭吗？',
  'doc.fontSize': '阅读字号',
  'doc.preview': '预览',
  'doc.save': '保存',
  'doc.saving': '保存中…',
  'doc.saved': '已保存',
  'doc.dirty': '未保存',
  'doc.unsupported': '当前文件类型暂不支持预览。',
  'selection.modify': '修改',
  'selection.ask': '提问',
  'selection.explain': '解释',
  'selection.summarize': '概括',
  'selection.openConversation': '打开对应选区对话',
  'selection.sourceNotFound': '无法把当前选区安全映射回 Markdown 源码，请重新选择较小范围后再修改。',
  'window.chat': '对话',
  'window.trajectory': '轨迹',
  'window.selection': '当前选区',
  'window.context': '上下文注入',
  'window.tool': '工具结果',
  'window.minimize': '最小化',
  'window.fullscreen': '全屏',
  'window.restore': '还原',
  'window.resize': '调整窗口大小',
  'window.close': '关闭',
  'window.hideDock': '隐藏底部标签',
  'window.accept': '采纳修改',
  'window.invalidReplacement': '无法采纳：回复中必须包含且仅包含一个 markdown 代码块。',
  'window.sourceChanged': '无法采纳：原文件中的待替换文本已经变化，请重新选择。',
  'window.creating': '正在创建分支',
  'window.deleting': '正在删除会话与上下文',
  'window.thinking': '思考中',
  'window.send': '发送',
  'window.stop': '停止',
  'window.sendPlaceholder': '继续追问…',
  'window.askPlaceholder': '请输入你想问的具体问题…',
  'window.modifyPlaceholder': '请输入具体修改要求…',
  'window.acceptConfirm': '采纳后将写入文件并关闭此窗口。继续？',
}

/** English dictionary. */
export const en: Record<FileWorkspaceKey, string> = {
  'mode.chat': 'Chat',
  'mode.files': 'Files',
  'panel.title': 'Workspaces',
  'panel.empty': 'No Workspaces yet. Click “Add workspace” to choose a directory.',
  'panel.addFolder': 'Add workspace',
  'panel.removeFolder': 'Remove workspace',
  'panel.loading': 'Loading…',
  'panel.error': 'Error: ',
  'tree.newFile': 'New file',
  'tree.newFolder': 'New folder',
  'tree.rename': 'Rename',
  'tree.delete': 'Delete',
  'tree.copy': 'Copy',
  'tree.paste': 'Paste',
  'tree.deleteConfirm': 'Delete “{name}”? This cannot be undone.',
  'tree.namePrompt': 'Name:',
  'doc.edit': 'Edit',
  'doc.empty': 'Choose a file from the file tree.',
  'doc.openFiles': 'Open files',
  'doc.close': 'Close {name}',
  'doc.closeDirty': '“{name}” has unsaved changes. Close it anyway?',
  'doc.fontSize': 'Reading font size',
  'doc.preview': 'Preview',
  'doc.save': 'Save',
  'doc.saving': 'Saving…',
  'doc.saved': 'Saved',
  'doc.dirty': 'Unsaved',
  'doc.unsupported': 'Preview is not available for this file type.',
  'selection.modify': 'Modify',
  'selection.ask': 'Ask',
  'selection.explain': 'Explain',
  'selection.summarize': 'Summarize',
  'selection.openConversation': 'Open linked selection conversation',
  'selection.sourceNotFound': 'The selection cannot be mapped safely to Markdown source. Select a smaller range and try again.',
  'window.chat': 'Chat',
  'window.trajectory': 'Trajectory',
  'window.selection': 'Selection',
  'window.context': 'Context injection',
  'window.tool': 'Tool result',
  'window.minimize': 'Minimize',
  'window.fullscreen': 'Fullscreen',
  'window.restore': 'Restore',
  'window.resize': 'Resize window',
  'window.close': 'Close',
  'window.hideDock': 'Hide minimized conversation',
  'window.accept': 'Accept change',
  'window.invalidReplacement': 'Cannot accept: the reply must contain exactly one markdown code block.',
  'window.sourceChanged': 'Cannot accept: the source text to replace has changed. Select it again.',
  'window.creating': 'Creating branch',
  'window.deleting': 'Deleting session and context',
  'window.thinking': 'Thinking',
  'window.send': 'Send',
  'window.stop': 'Stop',
  'window.sendPlaceholder': 'Ask a follow-up…',
  'window.askPlaceholder': 'Enter your specific question…',
  'window.modifyPlaceholder': 'Describe the requested change…',
  'window.acceptConfirm': 'Accepting writes the file and closes this window. Continue?',
}
