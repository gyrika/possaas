/**
 * The smallest PDF writer that does the job: A4 pages of text in the two fonts every PDF reader
 * has built in (Helvetica and Helvetica-Bold), so nothing is embedded and no package is needed
 * (like zip.ts). Text is Latin-1: anything else (Sinhala, Tamil, emoji) shows as "?", because
 * the built-in fonts cannot draw it.
 */
export const A4 = { width: 595, height: 842 };

export interface PdfText {
  x: number;
  /** From the top of the page, to the text's baseline. */
  y: number;
  text: string;
  size: number;
  bold?: boolean;
  /** Grey, for the lesser lines. */
  grey?: boolean;
  /** `x` is the right edge. */
  right?: boolean;
}
export interface PdfLine { x1: number; x2: number; y: number }
export interface PdfPage { texts: PdfText[]; lines?: PdfLine[] }

/** Helvetica's widths (1/1000 em) for characters 32-126, from Adobe's font metrics. */
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278,
  556, 556, 556, 556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556,
  1015, 667, 667, 722, 722, 667, 611, 778, 722, 278, 500, 667, 556, 833, 722, 778,
  667, 778, 722, 667, 611, 722, 667, 944, 667, 667, 611, 278, 278, 278, 469, 556,
  333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500, 222, 833, 556, 556,
  556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];
/** Bold letters run a little wider (its digits do not); close enough to line text up on the right. */
export const textWidth = (text: string, size: number, bold = false): number =>
  [...latin1(text)].reduce((w, ch) => w + (WIDTHS[ch.charCodeAt(0) - 32] ?? 556) * (bold && /[a-z]/i.test(ch) ? 1.08 : 1), 0) * size / 1000;

const latin1 = (text: string): string => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[^\x20-\x7e\xa0-\xff]/g, '?');
const escape = (text: string): string => latin1(text).replace(/[\\()]/g, (c) => `\\${c}`);
const num = (n: number): string => (Math.round(n * 100) / 100).toString();

const content = (page: PdfPage): string => {
  const out: string[] = [];
  for (const l of page.lines ?? []) out.push(`0.8 G 0.75 w ${num(l.x1)} ${num(A4.height - l.y)} m ${num(l.x2)} ${num(A4.height - l.y)} l S`);
  for (const t of page.texts) {
    const x = t.right ? t.x - textWidth(t.text, t.size, t.bold) : t.x;
    out.push(`BT /${t.bold ? 'F2' : 'F1'} ${t.size} Tf ${t.grey ? '0.4' : '0'} g ${num(x)} ${num(A4.height - t.y)} Td (${escape(t.text)}) Tj ET`);
  }
  return out.join('\n');
};

/** The finished file. */
export function pdf(pages: PdfPage[], title = ''): Buffer {
  const objects: string[] = [];
  const add = (body: string): number => objects.push(body);
  const catalog = add('');
  const tree = add('');
  const regular = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  const bold = add('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>');
  const info = add(`<< /Title (${escape(title)}) /Producer (Lume POS) >>`);
  const kids = pages.map((p) => {
    const stream = content(p);
    const contents = add(`<< /Length ${Buffer.byteLength(stream, 'latin1')} >>\nstream\n${stream}\nendstream`);
    return add(`<< /Type /Page /Parent ${tree} 0 R /MediaBox [0 0 ${A4.width} ${A4.height}] /Resources << /Font << /F1 ${regular} 0 R /F2 ${bold} 0 R >> >> /Contents ${contents} 0 R >>`);
  });
  objects[catalog - 1] = `<< /Type /Catalog /Pages ${tree} 0 R >>`;
  objects[tree - 1] = `<< /Type /Pages /Kids [${kids.map((k) => `${k} 0 R`).join(' ')}] /Count ${kids.length} >>`;

  let file = '%PDF-1.4\n';
  const offsets = objects.map((body, i) => {
    const at = Buffer.byteLength(file, 'latin1');
    file += `${i + 1} 0 obj\n${body}\nendobj\n`;
    return at;
  });
  const xref = Buffer.byteLength(file, 'latin1');
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}`;
  file += `trailer\n<< /Size ${objects.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(file, 'latin1');
}
