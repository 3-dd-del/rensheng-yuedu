export interface ShortcutDefinition {
  /** 界面提示中的按键展示（如 “←”）。 */
  keys: string;
  /** 对应 KeyboardEvent.key 值。 */
  key: string;
  /** 显示名称。 */
  label: string;
  scope: 'library' | 'reader' | 'dialog';
}

export const SHORTCUTS: ShortcutDefinition[] = [
  { keys: '← / →', key: 'ArrowLeft', label: '翻页（上一页/下一页）', scope: 'reader' },
  { keys: 'Space / →', key: ' ', label: '下一页', scope: 'reader' },
  { keys: 'Esc', key: 'Escape', label: '返回书架 / 关闭面板', scope: 'reader' },
  { keys: 'S', key: 's', label: '打开 / 关闭阅读设置', scope: 'reader' },
  { keys: '?', key: '?', label: '查看快捷键说明', scope: 'reader' },
  { keys: '+ / -', key: '+', label: '调整字号（设置面板打开时）', scope: 'reader' },
  { keys: 'Enter', key: 'Enter', label: '打开选中的书', scope: 'library' },
  { keys: '↑ / ↓', key: 'ArrowDown', label: '书架中选择书籍', scope: 'library' },
  { keys: 'Delete', key: 'Delete', label: '删除选中的书（需确认）', scope: 'library' }
];

export function shortcutsForScope(scope: ShortcutDefinition['scope']): ShortcutDefinition[] {
  return SHORTCUTS.filter((item) => item.scope === scope);
}
