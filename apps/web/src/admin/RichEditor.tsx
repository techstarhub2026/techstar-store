import { useEffect, useRef, useState } from 'react';
import { EditorContent, useEditor, type Editor } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import Link from '@tiptap/extension-link';
import Image from '@tiptap/extension-image';
import Placeholder from '@tiptap/extension-placeholder';
import {
  Bold, Code, Heading2, Heading3, ImagePlus, Italic, Link2, Link2Off, List,
  ListOrdered, Loader2, Quote, Redo2, RemoveFormatting, Strikethrough, Undo2,
} from 'lucide-react';
import { api } from '../lib/api';
import { useUi } from '../stores';
import type { MediaDto } from '../lib/types';

const IMAGE_ACCEPT = 'image/jpeg,image/png,image/webp,image/avif';
const IMAGE_MAX_MB = 5;

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

function Toolbar({ editor, onInsertImage, imageUploading }: {
  editor: Editor;
  onInsertImage: () => void;
  imageUploading: boolean;
}) {
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
      {
        icon: imageUploading ? <Loader2 size={15} className="spin" /> : <ImagePlus size={15} />,
        title: 'Insert image', run: onInsertImage,
      },
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
  const toast = useUi((s) => s.toast);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageUploading, setImageUploading] = useState(false);

  const editor = useEditor({
    extensions: [
      // StarterKit bundles its own Link extension as of Tiptap v3; disabled
      // here so the explicit Link.configure() below — carrying this editor's
      // actual settings (no click-through, autolink) — is the only one
      // registered. Both being active at once produced a harmless but real
      // "Duplicate extension names found: ['link']" console warning.
      StarterKit.configure({ heading: { levels: [2, 3] }, link: false }),
      Link.configure({ openOnClick: false, autolink: true }),
      // `inline: false` keeps every inserted photo on its own line — this is
      // article/news body copy, not a chat bubble with an avatar beside it.
      Image.configure({ inline: false, allowBase64: false }),
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

  /**
   * Uploads straight to the same media store `ImageUploader` uses — a photo
   * dropped into an article body is a real asset (immutable-cached, in the
   * media library) rather than a base64 blob bloating the HTML column, which
   * `allowBase64: false` above also forecloses.
   */
  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file || !editor) return;
    if (file.size > IMAGE_MAX_MB * 1024 * 1024) {
      toast({ tone: 'danger', title: 'File too large', text: `Images must be ${IMAGE_MAX_MB} MB or smaller.` });
      return;
    }
    if (!IMAGE_ACCEPT.split(',').includes(file.type)) {
      toast({ tone: 'danger', title: 'Unsupported file type', text: 'Only JPEG, PNG, WebP and AVIF are accepted.' });
      return;
    }
    setImageUploading(true);
    try {
      const fd = new FormData();
      fd.append('files', file);
      const [stored] = await api.post<MediaDto[]>('/admin/media', fd);
      if (stored) {
        editor.chain().focus().setImage({ src: stored.lg, alt: '' }).run();
      }
    } catch {
      toast({ tone: 'danger', title: 'Upload failed', text: 'The image could not be uploaded. Please try again.' });
    } finally {
      setImageUploading(false);
    }
  };

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
        {editor ? (
          <Toolbar
            editor={editor}
            imageUploading={imageUploading}
            onInsertImage={() => { if (!imageUploading) fileInputRef.current?.click(); }}
          />
        ) : null}
        <EditorContent editor={editor} className="ts-rte__body" style={{ minHeight }} />
        <input
          ref={fileInputRef}
          type="file"
          accept={IMAGE_ACCEPT}
          hidden
          onChange={(e) => { void handleFiles(e.target.files); e.target.value = ''; }}
        />
      </div>

      {error ? <div className="ts-error">{error}</div> : hint ? <div className="ts-hint">{hint}</div> : null}
    </div>
  );
}
