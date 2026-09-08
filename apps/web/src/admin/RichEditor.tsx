import { useEffect } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Code, Heading2, Heading3, Italic, Link2, Link2Off, List, ListOrdered,
  Quote, Redo2, RemoveFormatting, Strikethrough, Undo2,
} from 'lucide-react';

/**
 * A visual editor for the admin's long-form fields.
 *
 * Content is still stored as HTML — the API sanitises and indexes it exactly as
 * before — but nobody has to type a tag to produce it. Shop staff writing a
 * product description should never see `<p>`; that was the whole problem with
 * the plain textareas this replaces.
 */

interface ToolButton {
  icon: React.ReactNode;
  title: string;
  isActive?: () => boolean;
  run: () => void;
}

function Toolbar({ editor }: { editor: Editor }) {
  const promptLink = () => {
    const previous = editor.getAttributes('link').href ?? '';
    const url = window.prompt('Link address (leave empty to remove)', previous);
    if (url === null) return;
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run();
      return;
    }
    // Bare domains are a common paste; make them real links rather than
    // silently producing an href the browser resolves as a relative path.
    const href = /^(https?:|mailto:|tel:|\/)/i.test(url) ? url : `https://${url}`;
    editor.chain().focus().extendMarkRange('link').setLink({ href }).run();
  };

  const groups: ToolButton[][] = [
    [
      { icon: <Bold size={15} />, title: 'Bold', isActive: () => editor.isActive('bold'), run: () => editor.chain().focus().toggleBold().run() },
      { icon: <Italic size={15} />, title: 'Italic', isActive: () => editor.isActive('italic'), run: () => editor.chain().focus().toggleItalic().run() },
      { icon: <Strikethrough size={15} />, title: 'Strikethrough', isActive: () => editor.isActive('strike'), run: () => editor.chain().focus().toggleStrike().run() },
      { icon: <Code size={15} />, title: 'Inline code', isActive: () => editor.isActive('code'), run: () => editor.chain().focus().toggleCode().run() },
    ],
    [
      { icon: <Heading2 size={15} />, title: 'Heading', isActive: () => editor.isActive('heading', { level: 2 }), run: () => editor.chain().focus().toggleHeading({ level: 2 }).run() },
      { icon: <Heading3 size={15} />, title: 'Subheading', isActive: () => editor.isActive('heading', { level: 3 }), run: () => editor.chain().focus().toggleHeading({ level: 3 }).run() },
    ],
    [
      { icon: <List size={15} />, title: 'Bulleted list', isActive: () => editor.isActive('bulletList'), run: () => editor.chain().focus().toggleBulletList().run() },
      { icon: <ListOrdered size={15} />, title: 'Numbered list', isActive: () => editor.isActive('orderedList'), run: () => editor.chain().focus().toggleOrderedList().run() },
      { icon: <Quote size={15} />, title: 'Quote', isActive: () => editor.isActive('blockquote'), run: () => editor.chain().focus().toggleBlockquote().run() },
    ],
    [
      { icon: <Link2 size={15} />, title: 'Add link', isActive: () => editor.isActive('link'), run: promptLink },
      { icon: <Link2Off size={15} />, title: 'Remove link', run: () => editor.chain().focus().unsetLink().run() },
      { icon: <RemoveFormatting size={15} />, title: 'Clear formatting', run: () => editor.chain().focus().unsetAllMarks().clearNodes().run() },
    ],
    [
      { icon: <Undo2 size={15} />, title: 'Undo', run: () => editor.chain().focus().undo().run() },
      { icon: <Redo2 size={15} />, title: 'Redo', run: () => editor.chain().focus().redo().run() },
    ],
  ];

  return (
    <div className="ts-rte__bar">
      {groups.map((group, gi) => (
        <div className="ts-rte__group" key={gi}>
          {group.map((b) => (
            <button
              key={b.title}
              type="button"
              title={b.title}
              aria-label={b.title}
              aria-pressed={b.isActive?.() ?? undefined}
              className={`ts-rte__btn ${b.isActive?.() ? 'is-on' : ''}`}
              onMouseDown={(e) => e.preventDefault()}
              onClick={b.run}
            >
              {b.icon}
            </button>
          ))}
        </div>
      ))}
    </div>
  );
}

export function RichEditor({
  label,
  value,
  onChange,
  error,
  hint,
  required,
  placeholder = 'Write here…',
  minHeight = 220,
}: {
  label?: string;
  value: string;
  onChange: (html: string) => void;
  error?: string;
  hint?: string;
  required?: boolean;
  placeholder?: string;
  minHeight?: number;
}) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [2, 3] } }),
      Link.configure({ openOnClick: false, autolink: true }),
      Placeholder.configure({ placeholder }),
    ],
    content: value || '',
    onUpdate: ({ editor: e }) => {
      // TipTap represents "empty" as <p></p>; store a true empty string so
      // required-field validation on the server still sees nothing.
      const html = e.getHTML();
      onChange(html === '<p></p>' ? '' : html);
    },
  });

  // Re-sync when the form loads its record after the editor has mounted.
  useEffect(() => {
    if (!editor) return;
    const current = editor.getHTML();
    const incoming = value || '';
    if (incoming !== current && !(incoming === '' && current === '<p></p>')) {
      editor.commands.setContent(incoming, { emitUpdate: false });
    }
  }, [value, editor]);

  return (
    <div className="mb-3">
      {label ? (
        <label className="ts-label">
          {label}
          {required ? <span aria-hidden style={{ color: 'var(--ts-danger)' }}> *</span> : null}
        </label>
      ) : null}

      <div className={`ts-rte ${error ? 'ts-rte--error' : ''}`}>
        {editor ? <Toolbar editor={editor} /> : null}
        <EditorContent editor={editor} className="ts-rte__body" style={{ minHeight }} />
      </div>

      {error ? <div className="ts-error">{error}</div> : hint ? <div className="ts-hint">{hint}</div> : null}
    </div>
  );
}
