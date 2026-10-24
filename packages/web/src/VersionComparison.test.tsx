import { afterEach, describe, expect, it, vi } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ApiError, type Version, type VersionSnapshot } from './api';
import VersionComparison, {
  ComparisonResult,
  HistoricalSnapshot,
  readVersionComparison,
  readVersionSnapshot,
  VersionComparisonContent,
} from './VersionComparison';

const noop = () => {};
const versions: Version[] = [
  { version: 1, kind: 'create', createdBy: 'u_first', createdAt: '2026-10-20T00:00:00Z' },
  { version: 3, kind: 'restore', createdBy: 'u_owner', createdAt: '2026-10-22T00:00:00Z' },
  { version: 2, kind: 'publish', authorName: '<script>Author</script>', createdAt: '2026-10-21T00:00:00Z' },
];
const props = {
  docId: 'd_aaaaaaaa',
  currentVersion: 3,
  locale: 'en' as const,
  canRestore: false,
  busy: false,
  onBack: noop,
  onRestore: noop,
};
const snapshot: VersionSnapshot = {
  number: 1,
  kind: 'create',
  createdBy: 'u_first',
  createdAt: '2026-10-20T00:00:00Z',
  content: {
    schemaVersion: 1,
    id: 'd_aaaaaaaa',
    title: '<script>Historical title</script>',
    theme: { id: 'default', version: 1, overrides: {} },
    modules: [
      {
        id: 'm_aaaaaaaa',
        title: 'Original section',
        blocks: [{ id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: 'Original published body', b: true }] }],
      },
    ],
  },
};

afterEach(() => vi.unstubAllGlobals());

describe('version history and comparison markup', () => {
  it('loads history without rendering an empty history or differences before a response', () => {
    const html = renderToStaticMarkup(<VersionComparison {...props} />);
    expect(html).toContain('Loading version history');
    expect(html).not.toContain('No content differences');
    expect(html).not.toContain('No published versions');
  });

  it('defaults to the preceding and latest versions, shows metadata, and exposes read-only history to viewers', () => {
    const html = renderToStaticMarkup(<VersionComparisonContent {...props} versions={versions} />);
    expect(html).toContain('value="2" selected=""');
    expect(html).toContain('value="3" selected=""');
    expect(html).toContain('v3 · Restored');
    expect(html).toContain('Created by: Unknown user');
    expect(html).not.toContain('u_owner');
    expect(html).not.toContain('u_first');
    expect(html).toContain('&lt;script&gt;Author&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).toContain('Full document before');
    expect(html).toContain('View this version');
    expect(html).toContain('Compare with current');
    expect(html).not.toContain('Preview restoring this version');
    expect(html).toContain('Personal drafts and pending submissions are excluded');
  });

  it('B1 hides internal creator IDs and falls back to an unknown-user label', () => {
    const html = renderToStaticMarkup(
      <VersionComparisonContent
        {...props}
        versions={[{ version: 1, kind: 'create', createdBy: 'u_internal', createdAt: '2026-10-20T00:00:00Z' }]}
      />,
    );
    expect(html).toContain('Unknown user');
    expect(html).not.toContain('u_internal');
    const named = renderToStaticMarkup(
      <VersionComparisonContent
        {...props}
        versions={[{ version: 1, authorName: 'Reader name', createdBy: 'u_named' }]}
      />,
    );
    expect(named).toContain('Reader name');
    expect(named).not.toContain('u_named');
  });

  it('only exposes historical restore preview actions for owners and disables them while busy', () => {
    const html = renderToStaticMarkup(
      <VersionComparisonContent {...props} versions={versions} canRestore busy locale="zh-CN" />,
    );
    expect(html.match(/disabled="">预览恢复此版本/g)).toHaveLength(2);
    expect(html).toContain('恢复发布');
    expect(html).toContain('修改前完整文档');
    expect(html).toContain('修改后完整文档');
  });

  it('supports a single version and truthfully handles an empty history', () => {
    const single = renderToStaticMarkup(<VersionComparisonContent {...props} versions={[versions[0]!]} canRestore />);
    expect(single).toContain('disabled="">View this version’s changes');
    expect(single).toContain('View this version</button>');
    expect(single).not.toContain('Preview restoring this version');
    expect(renderToStaticMarkup(<VersionComparisonContent {...props} versions={[]} />)).toContain(
      'No published versions are available',
    );
  });

  it('hides stale comparison results and distinguishes current empty, unavailable and access errors', () => {
    const old = {
      key: 'previous-selection',
      status: 'ready' as const,
      value: { from: 1, to: 2, changeSet: { changes: [] } },
    };
    const stale = renderToStaticMarkup(
      <ComparisonResult requestKey="current-selection" resource={old} locale="en" onRetry={noop} />,
    );
    expect(stale).toContain('Comparing versions');
    expect(stale).not.toContain('No content differences');
    expect(
      renderToStaticMarkup(<ComparisonResult requestKey={old.key} resource={old} locale="en" onRetry={noop} />),
    ).toContain('No content differences');
    expect(
      renderToStaticMarkup(
        <ComparisonResult
          requestKey="ready"
          resource={{ key: 'ready', status: 'ready', value: { from: 1, to: 2 } }}
          locale="en"
          onRetry={noop}
        />,
      ),
    ).toContain('comparison is unavailable');
    const denied = renderToStaticMarkup(
      <ComparisonResult
        requestKey="error"
        resource={{ key: 'error', status: 'error', reason: new ApiError('FORBIDDEN', '', 403) }}
        locale="zh-CN"
        onRetry={noop}
      />,
    );
    expect(denied).toContain('已没有读取权限');
    expect(denied).toContain('重新读取');
    expect(denied).not.toContain('没有内容差异');
  });

  it('renders the actual selected historical snapshot with a read-only banner and escaped content', () => {
    const resource = { key: 'v1', status: 'ready' as const, value: snapshot };
    const html = renderToStaticMarkup(
      <HistoricalSnapshot requestKey="v1" resource={resource} locale="en" onRetry={noop} />,
    );
    expect(html).toContain('Read-only historical snapshot');
    expect(html).toContain('v1');
    expect(html).toContain('Original section');
    expect(html).toContain('<strong>Original published body</strong>');
    expect(html).toContain('&lt;script&gt;Historical title&lt;/script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('contenteditable');
    expect(html).not.toContain('<textarea');
    const stale = renderToStaticMarkup(
      <HistoricalSnapshot requestKey="v2" resource={resource} locale="en" onRetry={noop} />,
    );
    expect(stale).toContain('Loading historical document');
    expect(stale).not.toContain('Original published body');
  });
});

describe('version reads', () => {
  it(
    'requests explicit immutable version numbers, including reverse comparison, ' + 'with the caller abort signal',
    async () => {
      const controller = new AbortController();
      const fetch = vi
        .fn()
        .mockResolvedValue(new Response(JSON.stringify({ from: 3, to: 1, changeSet: { changes: [] } })));
      vi.stubGlobal('fetch', fetch);
      expect(await readVersionComparison('d/a b', 3, 1, controller.signal)).toEqual({
        from: 3,
        to: 1,
        changeSet: { changes: [] },
      });
      expect(fetch).toHaveBeenCalledWith(
        '/api/v1/docs/d%2Fa%20b/compare?from=3&to=1',
        expect.objectContaining({ signal: controller.signal, method: 'GET', credentials: 'same-origin' }),
      );
    },
  );

  it('rejects a mismatched comparison instead of labeling it with the requested versions', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response(JSON.stringify({ from: 1, to: 4, changeSet: { changes: [] } }))),
    );
    await expect(readVersionComparison(props.docId, 1, 3, new AbortController().signal)).rejects.toThrow(
      'COMPARISON_VERSION_MISMATCH',
    );
  });

  it('suppresses a late comparison response even when the transport ignores cancellation', async () => {
    const controller = new AbortController();
    let resolve!: (response: Response) => void;
    vi.stubGlobal(
      'fetch',
      vi.fn(
        () =>
          new Promise<Response>((done) => {
            resolve = done;
          }),
      ),
    );
    const request = readVersionComparison(props.docId, 1, 2, controller.signal);
    controller.abort();
    resolve(new Response(JSON.stringify({ from: 1, to: 2, changeSet: { changes: [] } })));
    await expect(request).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('reads the selected snapshot and rejects wrong-version or cancelled snapshot responses', async () => {
    const fetch = vi
      .fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: snapshot })))
      .mockResolvedValueOnce(new Response(JSON.stringify({ version: { ...snapshot, number: 2 } })));
    vi.stubGlobal('fetch', fetch);
    expect(await readVersionSnapshot(props.docId, 1, new AbortController().signal)).toEqual(snapshot);
    expect(fetch).toHaveBeenCalledWith(
      '/api/v1/docs/d_aaaaaaaa/versions/1',
      expect.objectContaining({ method: 'GET' }),
    );
    await expect(readVersionSnapshot(props.docId, 1, new AbortController().signal)).rejects.toThrow(
      'SNAPSHOT_VERSION_MISMATCH',
    );
    const controller = new AbortController();
    controller.abort();
    await expect(readVersionSnapshot(props.docId, 1, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(fetch).toHaveBeenCalledTimes(2);
  });
});
