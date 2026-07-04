'use client';

import { useEditor, EditorContent } from '@tiptap/react';
import StarterKit from '@tiptap/starter-kit';
import { Button, ButtonGroup, BlockStack } from '@shopify/polaris';
import { useEffect } from 'react';

type Props = {
  value: string;
  onChange: (html: string) => void;
};

export function RichTextEditor({ value, onChange }: Props) {
  const editor = useEditor({
    extensions: [StarterKit],
    content: value,
    onUpdate: ({ editor: current }) => {
      onChange(current.getHTML());
    },
    editorProps: {
      attributes: {
        class: 'nova-editor',
      },
    },
  });

  useEffect(() => {
    if (!editor) return;
    if (editor.getHTML() !== value) {
      editor.commands.setContent(value, false);
    }
  }, [editor, value]);

  if (!editor) {
    return null;
  }

  return (
    <BlockStack gap="200">
      <ButtonGroup>
        <Button
          pressed={editor.isActive('bold')}
          onClick={() => editor.chain().focus().toggleBold().run()}
        >
          Bold
        </Button>
        <Button
          pressed={editor.isActive('italic')}
          onClick={() => editor.chain().focus().toggleItalic().run()}
        >
          Italic
        </Button>
        <Button
          pressed={editor.isActive('bulletList')}
          onClick={() => editor.chain().focus().toggleBulletList().run()}
        >
          List
        </Button>
      </ButtonGroup>
      <div className="nova-editor-shell">
        <EditorContent editor={editor} />
      </div>
    </BlockStack>
  );
}
