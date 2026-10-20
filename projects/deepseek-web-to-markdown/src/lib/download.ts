import JSZip from 'jszip';
import type { Article } from './db';

export function safeFilename(value: string): string {
  const cleaned = value
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/[. ]+$/g, '')
    .trim()
    .slice(0, 100);
  return cleaned || 'untitled';
}

export function downloadText(filename: string, content: string): void {
  const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export async function downloadArticlesIndividually(articles: Article[]): Promise<void> {
  for (const article of articles) {
    downloadText(`${safeFilename(article.title)}.md`, article.markdown);
    await new Promise((resolve) => window.setTimeout(resolve, 300));
  }
}

export async function downloadZip(articles: Article[]): Promise<void> {
  const zip = new JSZip();
  const usedNames = new Set<string>();
  for (const article of articles) {
    const base = safeFilename(article.title);
    let filename = `${base}.md`;
    let index = 2;
    while (usedNames.has(filename.toLowerCase())) {
      filename = `${base}-${index}.md`;
      index += 1;
    }
    usedNames.add(filename.toLowerCase());
    zip.file(filename, article.markdown);
  }
  const blob = await zip.generateAsync({ type: 'blob', compression: 'DEFLATE', compressionOptions: { level: 6 } });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `markdown-export-${new Date().toISOString().slice(0, 10)}.zip`;
  anchor.style.display = 'none';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
