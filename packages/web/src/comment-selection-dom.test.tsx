// @vitest-environment jsdom
import { act } from 'react';
import { type Root } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { relocateAnchor } from '../../core/src/anchors';
import { commentSelectionFromDom } from './comment-selection';
import BlockRead from './BlockRead';

import { model, fixture, select, selectNode, read, markupInto } from './test-fixtures/comment-selection';

let mounted: Root | undefined;
afterEach(() => {
  if (mounted) act(() => mounted!.unmount());
  mounted = undefined;
  window.getSelection()?.removeAllRanges();
  document.body.replaceChildren();
  vi.restoreAllMocks();
});

describe('synthetic DOM selection', () => {
  it('accepts the actual read renderer field markup without inheriting nested-list text', () => {
    const root = fixture(
      renderToStaticMarkup(
        <>
          {model.modules.map((module) => (
            <section key={module.id} data-hcd-module-id={module.id}>
              {module.blocks.map((block) => (
                <BlockRead key={block.id} block={block} locale="en" />
              ))}
            </section>
          ))}
        </>,
      ),
    );
    const fields = root.querySelectorAll('[data-hcd-node-id][data-hcd-field]');
    expect(fields.length).toBeGreaterThanOrEqual(7);
    for (const field of fields) {
      if (!field.textContent) continue;
      select(field, 0, field, field.childNodes.length);
      expect(
        read(root),
        `${field.getAttribute('data-hcd-node-id')}:${field.getAttribute('data-hcd-field')}`,
      ).toMatchObject({ kind: 'ready' });
    }
    const parent = root.querySelector('[data-hcd-node-id="n_gggggggg"]')!;
    select(parent, 0, parent, parent.childNodes.length);
    expect(read(root)).toMatchObject({ anchor: { quote: 'Parent', blockId: 'n_gggggggg' } });
  });
  it('counts BR as newline across inline marks and links with text or element boundaries', () => {
    const root = fixture();
    const field = root.querySelector('[data-hcd-node-id]')!;
    const world = field.querySelector('a')!.firstChild!;
    const selection = select(field.childNodes[1]!, 0, world, 2);
    expect(selection.toString()).toBe('🌍wo');
    expect(read(root, selection)).toMatchObject({
      kind: 'ready',
      anchor: { quote: '🌍\nwo', prefix: 'Hello ', suffix: 'rld' },
    });
    select(field, 1, field, 3);
    expect(read(root)).toMatchObject({ anchor: { quote: '🌍\n' } });
    select(field, 0, field, 4);
    expect(read(root)).toMatchObject({ anchor: { quote: 'Hello 🌍\nworld' } });
  });
  it('handles backwards selection using the ordered Range boundaries', () => {
    const root = fixture();
    const field = root.querySelector('[data-hcd-node-id]')!;
    const selection = window.getSelection()!;
    selection.setBaseAndExtent(field.querySelector('a')!.firstChild!, 2, field.childNodes[1]!, 0);
    expect(read(root)).toMatchObject({ kind: 'ready', anchor: { quote: '🌍\nwo' } });
  });
  it('accepts selectNode(field) parent endpoints without changing the native Range', () => {
    const root = fixture();
    const field = root.querySelector('[data-hcd-node-id]')!;
    const selection = selectNode(field);
    const range = selection.getRangeAt(0);
    expect(range.startContainer).toBe(field.parentNode);
    expect(range.startOffset).toBe(0);
    expect(range.endOffset).toBe(1);
    const result = read(root, selection);
    expect(result).toMatchObject({ kind: 'ready', anchor: { quote: 'Hello 🌍\nworld', prefix: '', suffix: '' } });
    if (result.kind === 'ready') expect(relocateAnchor(result.anchor, model).range).toEqual({ start: 0, end: 14 });
    expect(selection.getRangeAt(0)).toBe(range);
    expect(range.startContainer).toBe(field.parentNode);
    expect(range.endOffset).toBe(1);
  });
  it('maps one parent endpoint and one field endpoint precisely, including Unicode boundaries', () => {
    const root = fixture();
    const field = root.querySelector('[data-hcd-node-id]')!;
    const parent = field.parentNode!;
    const world = field.querySelector('a')!.firstChild!;
    select(parent, 0, world, 2);
    expect(read(root)).toMatchObject({ kind: 'ready', anchor: { quote: 'Hello 🌍\nwo', prefix: '', suffix: 'rld' } });
    select(field.childNodes[1]!, 0, parent, 1);
    expect(read(root)).toMatchObject({ kind: 'ready', anchor: { quote: '🌍\nworld', prefix: 'Hello ', suffix: '' } });
    select(parent, 0, field.childNodes[1]!, 1);
    expect(read(root)).toEqual({ kind: 'invalid', reason: 'unicode' });
    select(field.childNodes[1]!, 1, parent, 1);
    expect(read(root)).toEqual({ kind: 'invalid', reason: 'unicode' });
  });
  it('accepts exact wrapper paths and ignores controls only when they are outside the Range', () => {
    const root = fixture(
      '<section data-hcd-module-id="m_aaaaaaaa"><button>Before</button><p><em>' +
        '<span data-hcd-node-id="n_bbbbbbbb" data-hcd-field="text">Other field</span>' +
        '</em></p><button>After</button></section>',
    );
    const section = root.firstChild!;
    const wrapper = root.querySelector('p')!;
    const field = root.querySelector('[data-hcd-node-id]')!;
    selectNode(wrapper);
    expect(read(root)).toMatchObject({ kind: 'ready', anchor: { quote: 'Other field' } });
    select(section, 1, field.firstChild!, 5);
    expect(read(root)).toMatchObject({ kind: 'ready', anchor: { quote: 'Other' } });
    select(field.firstChild!, 6, section, 2);
    expect(read(root)).toMatchObject({ kind: 'ready', anchor: { quote: 'field' } });
    select(section, 0, field.firstChild!, 5);
    expect(read(root)).toMatchObject({ kind: 'invalid', reason: 'unsupported' });
    select(field.firstChild!, 6, section, 3);
    expect(read(root)).toMatchObject({ kind: 'invalid', reason: 'unsupported' });
  });
  it('refuses parent paths containing adjacent text, whitespace, controls or hidden siblings', () => {
    for (const adjacent of [
      'Adjacent',
      ' ',
      '<!--empty-->',
      '<span></span>',
      '<button></button>',
      '<span hidden></span>',
      '<span data-hcd-raw="true"></span>',
      '<span contenteditable="true"></span>',
    ]) {
      for (const before of [true, false]) {
        const fieldMarkup = '<span data-hcd-node-id="n_bbbbbbbb" data-hcd-field="text">Other field</span>';
        const root = fixture(
          '<section data-hcd-module-id="m_aaaaaaaa"><p>' +
            (before ? adjacent + fieldMarkup : fieldMarkup + adjacent) +
            '</p></section>',
        );
        const wrapper = root.querySelector('p')!;
        const field = root.querySelector('[data-hcd-node-id]')!;
        selectNode(wrapper);
        expect(read(root), `${before ? 'before' : 'after'} ${adjacent}`).toEqual({
          kind: 'invalid',
          reason: 'unsupported',
        });
        if (before) select(wrapper, 0, field.firstChild!, 5);
        else select(field.firstChild!, 0, wrapper, wrapper.childNodes.length);
        expect(read(root), `partial ${adjacent}`).toEqual({ kind: 'invalid', reason: 'unsupported' });
        root.remove();
      }
    }
  });
  it('rejects whole containers and parent endpoints that include another field or module', () => {
    const root = fixture();
    const fields = root.querySelectorAll('[data-hcd-node-id]');
    const section = root.firstChild!;
    selectNode(section);
    expect(read(root)).toEqual({ kind: 'invalid', reason: 'cross_field' });
    select(section, 0, fields[1]!.firstChild!, 3);
    expect(read(root)).toEqual({ kind: 'invalid', reason: 'cross_field' });
    select(fields[0]!.firstChild!, 0, section, 2);
    expect(read(root)).toEqual({ kind: 'invalid', reason: 'cross_field' });
    select(root, 0, root, 2);
    expect(read(root)).toEqual({ kind: 'invalid', reason: 'cross_field' });
  });
  it('rejects hidden fields, hidden ancestors and hidden fragments even when their text matches the model', () => {
    for (const attribute of [
      'hidden',
      'inert',
      'aria-hidden="true"',
      'style="display:none"',
      'style="visibility:hidden"',
      'style="opacity:0"',
      'style="content-visibility:hidden"',
    ]) {
      for (const placement of ['field', 'ancestor', 'fragment']) {
        const text = placement === 'fragment' ? `Other <span ${attribute}>field</span>` : 'Other field';
        const root = fixture(
          `<section data-hcd-module-id="m_aaaaaaaa"><p ${placement === 'ancestor' ? attribute : ''}>` +
            '<span data-hcd-node-id="n_bbbbbbbb" data-hcd-field="text" ' +
            `${placement === 'field' ? attribute : ''}>${text}</span></p></section>`,
        );
        const field = root.querySelector('[data-hcd-node-id]')!;
        selectNode(field);
        expect(read(root), `${attribute} ${placement}`).toEqual({ kind: 'invalid', reason: 'unsupported' });
        select(field, 0, field, field.childNodes.length);
        expect(read(root), `inside ${attribute} ${placement}`).toEqual({ kind: 'invalid', reason: 'unsupported' });
        root.remove();
      }
    }
  });
  it('refuses hidden details content but accepts a visible summary and reopened data', () => {
    const root = fixture(
      '<section data-hcd-module-id="m_aaaaaaaa"><details><summary>' +
        '<span data-hcd-node-id="n_bbbbbbbb" data-hcd-field="text">Other field</span></summary><div>' +
        '<span data-hcd-node-id="n_bbbbbbbb" data-hcd-field="text">Other field</span></div></details></section>',
    );
    const details = root.querySelector('details')!;
    const fields = root.querySelectorAll('[data-hcd-node-id]');
    selectNode(fields[0]!);
    expect(read(root)).toMatchObject({ kind: 'ready', anchor: { quote: 'Other field' } });
    selectNode(fields[1]!);
    expect(read(root)).toEqual({ kind: 'invalid', reason: 'unsupported' });
    details.open = true;
    selectNode(fields[1]!);
    expect(read(root)).toMatchObject({ kind: 'ready', anchor: { quote: 'Other field' } });
  });
  it('keeps full-field model validation and quote limits when selecting a wrapper', () => {
    const root = fixture();
    const field = root.querySelector('[data-hcd-node-id="n_bbbbbbbb"]')!;
    field.textContent = 'Other changed';
    selectNode(field);
    expect(read(root)).toEqual({ kind: 'invalid', reason: 'changed' });
    const doc = structuredClone(model);
    const text = '中é🌍'.repeat(101);
    doc.modules[0]!.blocks[1] = { id: 'n_bbbbbbbb', type: 'paragraph', text: [{ t: text }] };
    field.textContent = text;
    const selection = selectNode(field);
    expect(commentSelectionFromDom({ root, selection, document: doc, version: 3 })).toEqual({
      kind: 'invalid',
      reason: 'too_long',
    });
    select(field.parentNode!, 0, field.firstChild!, 500);
    const result = commentSelectionFromDom({ root, selection, document: doc, version: 3 });
    expect(result).toMatchObject({ kind: 'ready', anchor: { quote: text.slice(0, 500) } });
    if (result.kind === 'ready') expect(relocateAnchor(result.anchor, doc).range).toEqual({ start: 0, end: 500 });
  });
  it('ignores outside/collapsed selections and refuses cross-field/module/multi-range selections', () => {
    const root = fixture();
    const fields = root.querySelectorAll('[data-hcd-node-id]');
    const first = fields[0]!.querySelector('strong')!.firstChild!;
    expect(read(root, null)).toEqual({ kind: 'none' });
    select(first, 0, first, 0);
    expect(read(root)).toEqual({ kind: 'none' });
    select(first, 0, fields[1]!.firstChild!, 3);
    expect(read(root)).toEqual({ kind: 'invalid', reason: 'cross_field' });
    select(first, 0, fields[2]!.firstChild!, 3);
    expect(read(root)).toEqual({ kind: 'invalid', reason: 'cross_field' });
    const outside = document.createTextNode('Outside');
    document.body.append(outside);
    select(outside, 0, outside, 7);
    expect(read(root)).toEqual({ kind: 'none' });
    select(first, 0, outside, 2);
    expect(read(root)).toEqual({ kind: 'invalid', reason: 'cross_field' });
    expect(read(root, { rangeCount: 2, isCollapsed: false } as Selection)).toEqual({
      kind: 'invalid',
      reason: 'cross_field',
    });
  });
  it('rejects editable, raw/iframe, nested-field and divergent rendered text', () => {
    for (const tag of ['span contenteditable="true"', 'span data-hcd-raw="true"', 'button', 'textarea']) {
      const name = tag.split(' ')[0];
      const root = fixture(
        `<section data-hcd-module-id="m_aaaaaaaa"><${tag} ` +
          `data-hcd-node-id="n_bbbbbbbb" data-hcd-field="text">Other field</${name}></section>`,
      );
      const field = root.querySelector('[data-hcd-node-id]')!;
      select(field.firstChild!, 0, field.firstChild!, 5);
      expect(read(root), tag).toMatchObject({ kind: 'invalid' });
      root.remove();
    }
    const svg = fixture(
      '<section data-hcd-module-id="m_aaaaaaaa"><svg>' +
        '<text data-hcd-node-id="n_bbbbbbbb" data-hcd-field="text">Other field</text></svg></section>',
    );
    const svgText = svg.querySelector('text')!.firstChild!;
    select(svgText, 0, svgText, 5);
    expect(read(svg)).toMatchObject({ kind: 'invalid' });
    svg.remove();
    const root = fixture();
    const field = root.querySelector('[data-hcd-node-id="n_bbbbbbbb"]')!;
    markupInto(field, '<span data-hcd-node-id="n_bbbbbbbb" data-hcd-field="text">Other</span> field');
    select(field, 0, field, 2);
    expect(read(root)).toMatchObject({ kind: 'invalid' });
    field.textContent = 'Rendered stale';
    select(field.firstChild!, 0, field.firstChild!, 4);
    expect(read(root)).toEqual({ kind: 'invalid', reason: 'changed' });
    markupInto(field, 'Other<iframe></iframe> field');
    select(field, 0, field, 3);
    expect(read(root)).toMatchObject({ kind: 'invalid' });
  });
});
