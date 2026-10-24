import { parse, serialize, type DefaultTreeAdapterMap } from 'parse5';
import { isImportTreeBounded } from '../../core/src/import-patterns';

export const rawCsp = "default-src 'none'; img-src data:; style-src 'unsafe-inline'; font-src data:; script-src 'none'; connect-src 'none'; form-action 'none'; base-uri 'none'; sandbox";
const removedTags = new Set(['script', 'noscript', 'template', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'base', 'link', 'meta', 'foreignobject', 'animate', 'animatemotion', 'animatetransform', 'set']);
const urlAttributes = new Set(['href', 'src', 'srcset', 'action', 'formaction', 'poster', 'data', 'background', 'ping', 'srcdoc', 'target', 'download']);
type Node = DefaultTreeAdapterMap['node'];
/** Safe static source; CSP also blocks resource loads from retained CSS. */
export function sanitizeRawHtml(source: string): string {
  const tree = parse(source);
  if (!isImportTreeBounded(tree, 100000, 64)) throw new Error('IMPORT_TOO_COMPLEX');
  const clean = (node: Node) => {
    if ('attrs' in node) node.attrs = node.attrs.filter((attr) => {
      if (/^on/i.test(attr.name)) return false;
      if (urlAttributes.has(attr.name)) return /^(?:#[a-zA-Z_][\w.-]*|data:image\/(?:png|jpeg|gif|webp);base64,[A-Za-z0-9+/=]+)$/.test(attr.value) && ['src', 'href'].includes(attr.name);
      return !['http-equiv', 'contenteditable', 'autofocus'].includes(attr.name);
    });
    if ('childNodes' in node) {
      node.childNodes = node.childNodes.filter((child) => !('tagName' in child && removedTags.has(child.tagName.toLowerCase())));
      node.childNodes.forEach(clean);
    }
  };
  clean(tree);
  const content = serialize(tree);
  // CSP meta also travels with a standalone exported srcdoc; sandbox is set on the containing iframe.
  return content.replace('<head>', `<head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${rawCsp.replace('; sandbox', '')}">`);
}
