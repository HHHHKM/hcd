import type { Block, IdSource } from '../../../../core/src/model';
export type Locale = 'zh-CN' | 'en';
export type BlockEditorProps<Kind extends Block['type'] = Block['type']> = {
  block: Extract<Block, { type: Kind }>;
  locale: Locale;
  onChange: (block: Block) => void;
  ids: IdSource;
};
