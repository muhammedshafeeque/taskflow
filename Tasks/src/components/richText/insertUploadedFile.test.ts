import type { Editor } from '@tiptap/core';
import { insertUploadedFile } from './insertUploadedFile';

function fakeEditor() {
  const chain = {
    focus: jest.fn().mockReturnThis(),
    setImage: jest.fn().mockReturnThis(),
    insertContent: jest.fn().mockReturnThis(),
    run: jest.fn(),
  };
  return { chain, editor: { chain: () => chain } as unknown as Editor };
}

const upload = (mimeType: string) => ({ url: '/api/uploads/f', originalName: 'f', mimeType, size: 1 });

describe('insertUploadedFile', () => {
  it('never puts a video in an image, whichever button was used', () => {
    const { chain, editor } = fakeEditor();
    insertUploadedFile(editor, upload('video/mp4'));
    expect(chain.setImage).not.toHaveBeenCalled();
    expect(chain.insertContent).toHaveBeenCalledWith({ type: 'videoBlock', attrs: { url: '/api/uploads/f', name: 'f' } });
    expect(chain.run).toHaveBeenCalled();
  });

  it('inserts images inline and anything else as an attachment', () => {
    const { chain, editor } = fakeEditor();
    insertUploadedFile(editor, upload('image/png'));
    expect(chain.setImage).toHaveBeenCalledWith({ src: '/api/uploads/f', alt: 'f' });
    insertUploadedFile(editor, upload('application/pdf'));
    expect(chain.insertContent).toHaveBeenCalledWith({
      type: 'attachmentBlock',
      attrs: { url: '/api/uploads/f', name: 'f', mimeType: 'application/pdf' },
    });
  });
});
