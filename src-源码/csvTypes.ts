export type SeparatorMode = 'extension' | 'auto' | 'default';

export type SeparatorSettings = {
  mode: SeparatorMode;
  defaultSeparator: string;
  byExtension: Record<string, string>;
};

export type CsvFieldSpan = {
  start: number;
  end: number;
  quoted: boolean;
};

export type PasteSelectionBounds = {
  minRow: number;
  maxRow: number;
  minCol: number;
  maxCol: number;
  rectangular: boolean;
};

export type PastePlan = {
  startRow: number;
  startCol: number;
  endRow: number;
  endCol: number;
  fillSelection: boolean;
};

export type PasteApplyResult = {
  changed: boolean;
  structuralChange: boolean;
  updates: Array<{ row: number; col: number; value: string }>;
  plan: PastePlan;
};

export type ChunkRenderState = {
  startAbs: number;
  allRows: string[][];
  allRowsCount: number;
  chunkRows: number;
  includeTrailingEmptyRow: boolean;
  addSerialIndex: boolean;
  numColumns: number;
  columnWidths: number[];
  columnColors: string[];
  clickableLinks: boolean;
  isDark: boolean;
  serialIndexWidthCh: number;
};

export type ChunkResponse = {
  html: string;
  nextStart: number;
  done: boolean;
};
