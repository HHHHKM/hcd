import { translate } from './shared/i18n';
import { useEffect, useRef, useState } from 'react';
import { Mark } from '@tiptap/core';
import { EditorContent, useEditor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import type { Inline } from '../../core/src/model';
import { RenderInline } from './BlockRead';
import { editorToInline, inlineToEditor, safeLink } from './inline-codec';

export { TextField } from './TextField';

export function SelectField<T extends string>({
  label,
  value,
  choices,
  onChange,
}: {
  label: string;
  value: T;
  choices: Array<[T, string]>;
  onChange: (value: T) => void;
}) {
  return (
    <label className="be-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.currentTarget.value as T)}>
        {choices.map(([key, name]) => (
          <option key={key} value={key}>
            {name}
          </option>
        ))}
      </select>
    </label>
  );
}

const Superscript = Mark.create({
  name: 'superscript',
  excludes: 'subscript',
  parseHTML: () => [{ tag: 'sup' }],
  renderHTML: () => ['sup', 0],
});
const Subscript = Mark.create({
  name: 'subscript',
  excludes: 'superscript',
  parseHTML: () => [{ tag: 'sub' }],
  renderHTML: () => ['sub', 0],
});
const Link = Mark.create({
  name: 'hcdLink',
  inclusive: false,
  addAttributes: () => ({ href: { default: null } }),
  parseHTML: () => [{ tag: 'a[href]' }],
  renderHTML: ({ HTMLAttributes }) => [
    'a',
    typeof HTMLAttributes.href === 'string' && safeLink(HTMLAttributes.href) ? { href: HTMLAttributes.href } : {},
    0,
  ],
});
const extensions = [
  StarterKit.configure({
    heading: false,
    blockquote: false,
    bulletList: false,
    orderedList: false,
    listItem: false,
    codeBlock: false,
    horizontalRule: false,
    strike: false,
    link: false,
    underline: false,
  }),
  Superscript,
  Subscript,
  Link,
];

function ActiveInline({
  value,
  onChange,
  label,
  locale,
}: {
  value: Inline;
  onChange: (value: Inline) => void;
  label: string;
  locale: 'zh-CN' | 'en';
}) {
  const latest = useRef({ value, onChange });
  latest.current = { value, onChange };
  const composing = useRef(false);
  const [link, setLink] = useState('');

  const editor = useEditor({
    extensions,
    content: inlineToEditor(value),
    autofocus: 'end',
    editorProps: {
      attributes: { 'aria-label': label, class: 'be-inline-content', role: 'textbox' },
      handleDOMEvents: {
        compositionstart: () => {
          composing.current = true;
          return false;
        },
        compositionend: (view) => {
          composing.current = false;
          queueMicrotask(() => {
            if (!view.isDestroyed && !view.composing) latest.current.onChange(editorToInline(view.state.doc.toJSON()));
          });
          return false;
        },
      },
    },
    onUpdate: ({ editor: current }) => {
      if (!composing.current && !current.view.composing) latest.current.onChange(editorToInline(current.getJSON()));
    },
  });
  useEffect(() => {
    if (!editor || composing.current || editor.view.composing) return;
    if (JSON.stringify(editorToInline(editor.getJSON())) !== JSON.stringify(value))
      editor.commands.setContent(inlineToEditor(value), { emitUpdate: false });
  }, [editor, value]);
  if (!editor) return null;
  const marks = [
    ['bold', translate(locale, 'editor.bold'), 'B'],
    ['italic', translate(locale, 'editor.italic'), 'I'],
    ['code', translate(locale, 'editor.inlineCode'), '</>'],
    ['superscript', translate(locale, 'editor.superscript'), 'x²'],
    ['subscript', translate(locale, 'editor.subscript'), 'x₂'],
  ];
  return (
    <>
      <div className="be-rich-toolbar" role="toolbar" aria-label={label}>
        {marks.map(([mark, name, text]) => (
          <button
            key={mark}
            type="button"
            aria-label={name}
            aria-pressed={editor.isActive(mark!)}
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => editor.chain().focus().toggleMark(mark!).run()}
          >
            {text}
          </button>
        ))}
        <input
          aria-label={translate(locale, 'editor.linkUrl')}
          placeholder="https://"
          value={link}
          onChange={(event) => setLink(event.currentTarget.value)}
        />
        <button
          type="button"
          disabled={!safeLink(link)}
          onClick={() => editor.chain().focus().setMark('hcdLink', { href: link }).run()}
        >
          {translate(locale, 'editor.link')}
        </button>
        <button type="button" onClick={() => editor.chain().focus().unsetMark('hcdLink').run()}>
          {translate(locale, 'editor.unlink')}
        </button>
      </div>
      <EditorContent editor={editor} />
    </>
  );
}

/** Mount a rich editor only for the active field, keeping large tables inexpensive. */
export function InlineField({
  label,
  value,
  onChange,
  locale,
}: {
  label: string;
  value: Inline;
  onChange: (value: Inline) => void;
  locale: 'zh-CN' | 'en';
}) {
  const [active, setActive] = useState(false);
  return (
    <div
      className="be-field be-inline"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setActive(false);
      }}
    >
      <span>{label}</span>
      {active ? (
        <ActiveInline value={value} onChange={onChange} label={label} locale={locale} />
      ) : (
        <button
          type="button"
          className="be-inline-preview"
          aria-label={label}
          onFocus={() => setActive(true)}
          onClick={() => setActive(true)}
        >
          {value.length ? (
            <RenderInline inline={value} links={false} />
          ) : (
            <span className="be-placeholder">{translate(locale, 'editor.clickToWrite')}</span>
          )}
        </button>
      )}
    </div>
  );
}
