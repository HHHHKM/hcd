// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relocateAnchor, AnchorSchema, type Anchor } from '../../core/src/anchors';
import type { Document as HcdDocument } from '../../core/src/model';
import { buildCommentAnchor } from './comment-selection';
import SelectionComment from './SelectionComment';

import { model, select, baseInput } from './test-fixtures/comment-selection';

let mounted: Root | undefined;
afterEach(() => {
  if (mounted) act(() => mounted!.unmount());
  mounted = undefined;
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('comment anchor construction', () => {
  it('uses UTF-16 offsets, preserves newlines and produces an exact core relocation', () => {
    const result = buildCommentAnchor(baseInput);
    expect(result).toEqual({
      kind: 'ready',
      anchor: {
        moduleId: 'm_aaaaaaaa',
        blockId: 'n_aaaaaaaa',
        field: 'text',
        quote: '🌍\nwo',
        prefix: 'Hello ',
        suffix: 'rld',
        version: 3,
      },
    });
    if (result.kind === 'ready') {
      expect(AnchorSchema.safeParse(result.anchor).success).toBe(true);
      expect(relocateAnchor(result.anchor, model).range).toEqual({ start: 6, end: 11 });
    }
  });
  it('uses nested list-item and table-cell identities rather than their outer blocks', () => {
    for (const [nodeId, field, text] of [
      ['n_hhhhhhhh', 'text', 'Child'],
      ['n_eeeeeeee', 'cell:n_dddddddd', 'Table cell'],
      ['n_dddddddd', 'header', 'Header'],
    ]) {
      const result = buildCommentAnchor({
        ...baseInput,
        nodeId: nodeId!,
        field: field!,
        text: text!,
        start: 0,
        end: text!.length,
      });
      expect(result).toMatchObject({ kind: 'ready', anchor: { blockId: nodeId, field, quote: text } });
      if (result.kind === 'ready') expect(relocateAnchor(result.anchor, model).state).toBe('ok');
    }
  });
  it('refuses changed text, cross-module identities, unsupported fields and invalid versions', () => {
    expect(buildCommentAnchor({ ...baseInput, text: 'Hello 🌍\nwrong' })).toEqual({
      kind: 'invalid',
      reason: 'changed',
    });
    for (const extra of [
      { moduleId: 'm_bbbbbbbb' },
      { nodeId: 'm_aaaaaaaa', field: 'title' },
      { field: 'note' },
      { nodeId: 'n_iiiiiiii', field: 'note', text: 'Raw note' },
      { version: 0 },
      { version: 1.2 },
      { start: -1 },
      { end: 90 },
    ])
      expect(buildCommentAnchor({ ...baseInput, ...extra })).toMatchObject({ kind: 'invalid' });
  });
  it('rejects split surrogate pairs and unpaired surrogates without trimming the quote', () => {
    expect(buildCommentAnchor({ ...baseInput, start: 7 })).toEqual({ kind: 'invalid', reason: 'unicode' });
    expect(buildCommentAnchor({ ...baseInput, start: 0, end: 7 })).toEqual({ kind: 'invalid', reason: 'unicode' });
    const bad = structuredClone(model);
    bad.modules[0]!.blocks[0] = { id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: 'a\ud800b' }] };
    expect(buildCommentAnchor({ ...baseInput, document: bad, text: 'a\ud800b', start: 0, end: 1 })).toEqual({
      kind: 'invalid',
      reason: 'unicode',
    });
    expect(buildCommentAnchor({ ...baseInput, start: 5, end: 9 })).toMatchObject({ anchor: { quote: ' 🌍\n' } });
  });
  it('bounds quotes and context without splitting supplementary characters', () => {
    const text = '🌍' + 'a'.repeat(31) + 'X' + 'b'.repeat(31) + '🌍';
    const doc = structuredClone(model);
    doc.modules[0]!.blocks[0] = { id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: text }] };
    const result = buildCommentAnchor({ ...baseInput, document: doc, text, start: 33, end: 34 });
    expect(result).toMatchObject({ kind: 'ready', anchor: { prefix: 'a'.repeat(31), suffix: 'b'.repeat(31) } });
    const long = 'x'.repeat(501);
    doc.modules[0]!.blocks[0] = { id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: long }] };
    expect(buildCommentAnchor({ ...baseInput, document: doc, text: long, start: 0, end: 500 })).toMatchObject({
      kind: 'ready',
    });
    expect(buildCommentAnchor({ ...baseInput, document: doc, text: long, start: 0, end: 501 })).toEqual({
      kind: 'invalid',
      reason: 'too_long',
    });
  });
  it('rejects a later repeated passage when bounded context would locate an earlier occurrence', () => {
    const text = 'x'.repeat(180);
    const doc = structuredClone(model);
    doc.modules[0]!.blocks[0] = { id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: text }] };
    expect(buildCommentAnchor({ ...baseInput, document: doc, text, start: 100, end: 105 })).toEqual({
      kind: 'invalid',
      reason: 'ambiguous',
    });
  });
  it('accepts a repeated passage when its surrounding context identifies the selected occurrence', () => {
    const text = 'x'.repeat(90) + ' marker ' + 'x'.repeat(90);
    const doc = structuredClone(model);
    doc.modules[0]!.blocks[0] = { id: 'n_aaaaaaaa', type: 'paragraph', text: [{ t: text }] };
    const result = buildCommentAnchor({ ...baseInput, document: doc, text, start: 108, end: 113 });
    expect(result).toMatchObject({ kind: 'ready', anchor: { quote: 'xxxxx' } });
    if (result.kind === 'ready')
      expect(relocateAnchor(result.anchor, doc)).toMatchObject({ state: 'ok', range: { start: 108, end: 113 } });
  });
});

describe('selection comment interaction in a synthetic DOM', () => {
  function mount(
    callback: (anchor: Anchor) => void,
    initial: { version?: number; disabled?: boolean; document?: HcdDocument; locale?: 'en' | 'zh-CN' } = {},
  ) {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const host = document.createElement('div');
    document.body.append(host);
    mounted = createRoot(host);
    const render = (props = initial) =>
      act(() =>
        mounted!.render(
          <SelectionComment
            document={props.document ?? model}
            version={props.version ?? 3}
            disabled={props.disabled}
            locale={props.locale ?? 'en'}
            onComment={callback}
          >
            <section data-hcd-module-id="m_aaaaaaaa">
              <span data-hcd-node-id="n_bbbbbbbb" data-hcd-field="text">
                Other field
              </span>
            </section>
          </SelectionComment>,
        ),
      );
    render();
    const capture = () =>
      act(() => {
        const text = host.querySelector('[data-hcd-node-id]')!.firstChild!;
        select(text, 0, text, 5);
        document.dispatchEvent(new Event('selectionchange'));
      });
    return { host, render, capture };
  }
  it('captures once, preserves the range on mousedown and sends the fixed anchor on click', () => {
    const callback = vi.fn();
    const { host, capture } = mount(callback);
    capture();
    expect(host.textContent).toContain('Comment on selected text');
    const button = host.querySelector('button')!;
    const event = new MouseEvent('mousedown', { bubbles: true, cancelable: true });
    act(() => {
      button.dispatchEvent(event);
    });
    expect(event.defaultPrevented).toBe(true);
    expect(window.getSelection()!.toString()).toBe('Other');
    act(() => button.click());
    expect(callback).toHaveBeenCalledExactlyOnceWith({
      moduleId: 'm_aaaaaaaa',
      blockId: 'n_bbbbbbbb',
      field: 'text',
      quote: 'Other',
      prefix: '',
      suffix: ' field',
      version: 3,
    });
    expect(host.querySelector('button')).toBeNull();
  });
  it('hides stale captured data on version/document/disabled changes and never submits an old selection', () => {
    const callback = vi.fn();
    const { host, render, capture } = mount(callback);
    capture();
    const oldButton = host.querySelector('button')!;
    render({ version: 4 });
    expect(host.querySelector('button')).toBeNull();
    act(() => oldButton.click());
    expect(callback).not.toHaveBeenCalled();
    capture();
    expect(host.querySelector('button')).not.toBeNull();
    render({ version: 4, disabled: true });
    expect(host.querySelector('button')).toBeNull();
    render({ version: 4, disabled: false });
    expect(host.querySelector('button')).toBeNull();
    capture();
    render({ document: structuredClone(model), version: 4 });
    expect(host.querySelector('button')).toBeNull();
    expect(callback).not.toHaveBeenCalled();
  });
  it('revalidates on click even if selection changes without an event and removes listeners on unmount', () => {
    const add = vi.spyOn(document, 'addEventListener');
    const remove = vi.spyOn(document, 'removeEventListener');
    const callback = vi.fn();
    const { host, capture } = mount(callback);
    capture();
    const button = host.querySelector('button')!;
    const text = host.querySelector('[data-hcd-node-id]')!.firstChild!;
    select(text, 1, text, 4);
    act(() => button.click());
    expect(callback).not.toHaveBeenCalled();
    const callbackAdded = add.mock.calls.find((call) => call[0] === 'selectionchange')![1];
    act(() => mounted!.unmount());
    mounted = undefined;
    expect(remove).toHaveBeenCalledWith('selectionchange', callbackAdded);
  });
  it('supports mouse and keyboard capture fallbacks and explains unsupported selections in Chinese', () => {
    const callback = vi.fn();
    const { host } = mount(callback, { locale: 'zh-CN' });
    const field = host.querySelector('[data-hcd-node-id]')!;
    act(() => {
      select(field.firstChild!, 0, field.firstChild!, 5);
      field.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    expect(host.querySelector('button')!.textContent).toBe('评论选中文字');
    act(() => {
      select(field.firstChild!, 0, field.firstChild!, 0);
      field.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'ArrowLeft' }));
    });
    expect(host.querySelector('button')).toBeNull();
    act(() => {
      field.textContent = 'Stale text';
      select(field.firstChild!, 0, field.firstChild!, 5);
      field.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));
    });
    expect(host.querySelector('[role="status"]')!.textContent).toContain('与当前版本不一致');
    expect(callback).not.toHaveBeenCalled();
  });
  it('retains a captured range while the keyboard action owns focus and revalidates its text', () => {
    const callback = vi.fn();
    const { host, capture } = mount(callback);
    capture();
    const button = host.querySelector('button')!;
    act(() => {
      button.focus();
      window.getSelection()!.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
    });
    expect(document.activeElement).toBe(button);
    expect(host.querySelector('button')).toBe(button);
    act(() => button.click());
    expect(callback).toHaveBeenCalledOnce();
    expect(callback.mock.calls[0]![0].quote).toBe('Other');
    callback.mockClear();
    capture();
    const next = host.querySelector('button')!;
    act(() => {
      next.focus();
      window.getSelection()!.removeAllRanges();
      document.dispatchEvent(new Event('selectionchange'));
      host.querySelector('[data-hcd-node-id]')!.textContent = 'Different';
    });
    act(() => next.click());
    expect(callback).not.toHaveBeenCalled();
  });
  it('renders content without selection controls on the server', () => {
    const markup = renderToStaticMarkup(
      <SelectionComment document={model} version={3} locale="zh-CN" onComment={() => {}}>
        内容
      </SelectionComment>,
    );
    expect(markup).toContain('内容');
    expect(markup).not.toContain('<button');
  });
});
