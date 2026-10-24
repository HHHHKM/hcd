import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import DiscussionThreads, { CommentText } from './DiscussionThreads';

describe('discussion rendering', () => {
  it('renders mention labels as escaped text and preserves plain text', () => {
    const html = renderToStaticMarkup(
      <CommentText text={'Hello @[<script>alert(1)</script>](u_test0000000)\n@[AI](ai) https://example.com'} />,
    );
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('@AI');
    expect(html).not.toContain('](u_test');
    expect(html).toContain('\n');
  });
  it('preserves deleted thread placeholders and hides write actions for viewers', () => {
    const html = renderToStaticMarkup(
      <DiscussionThreads
        docId="d_aaaaaaab"
        userId="u_test0000000"
        role="viewer"
        locale="zh-CN"
        aiEnabled={false}
        threads={[
          {
            root: {
              id: 'cm_root',
              authorId: 'u_test0000000',
              body: '',
              status: 'open',
              createdAt: '2026-01-01T00:00:00Z',
              deletedAt: '2026-01-02T00:00:00Z',
            },
            replies: [
              { id: 'cm_reply', authorId: 'u_another', body: 'Reply content', createdAt: '2026-01-01T00:00:00Z' },
            ],
          },
        ]}
        onRefresh={async () => {}}
      />,
    );
    expect(html).toContain('评论已删除');
    expect(html).toContain('Reply content');
    expect(html).not.toContain('标记为已解决');
    expect(html).not.toContain('textarea');
  });
  it('shows escaped quotations and location actions without offering draft-mode navigation', () => {
    const html = renderToStaticMarkup(
      <DiscussionThreads
        docId="d_aaaaaaaa"
        userId="u_fixture"
        role="viewer"
        locale="en"
        aiEnabled={false}
        locationDisabled
        threads={[
          {
            root: {
              id: 'cm_quote',
              authorId: 'u_fixture',
              body: 'Discuss',
              createdAt: '2026-10-23T00:00:00Z',
              anchor: { moduleId: 'm_aaaaaaaa', blockId: 'n_aaaaaaaa', quote: '<script>quote</script>', version: 1 },
            },
            replies: [],
            anchorState: 'text_changed',
          },
        ]}
        onRefresh={async () => {}}
      />,
    );
    expect(html).toContain('aria-label="Quoted text"');
    expect(html).toContain('&lt;script&gt;quote&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Go to quoted content');
    expect(html).toContain('disabled=""');
    expect(html).toContain('The quoted text changed');
  });
});
