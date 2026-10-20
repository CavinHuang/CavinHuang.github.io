import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  Archive,
  ArrowDownToLine,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  CircleHelp,
  Clock3,
  Copy,
  Download,
  ExternalLink,
  FileArchive,
  FileText,
  Globe2,
  HardDrive,
  KeyRound,
  Link2,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  StopCircle,
  Trash2,
  X,
  Zap,
} from 'lucide-react';
import DOMPurify from 'dompurify';
import { marked } from 'marked';
import { clearArticles, deleteArticle, getArticles, saveArticle, type Article } from './lib/db';
import { downloadArticlesIndividually, downloadText, downloadZip, safeFilename } from './lib/download';
import { DEFAULT_FETCH_ENDPOINT, fetchAccountBalance, fetchWebpageAsMarkdown } from './lib/deepseek';

type Settings = {
  apiKey: string;
  endpoint: string;
  delayMs: number;
};

type PreviewMode = 'split' | 'edit' | 'preview';
type PreviewTheme = 'paper' | 'github' | 'midnight';

const SETTINGS_KEY = 'deepseek-web-markdown-settings-v1';
const DEFAULT_SETTINGS: Settings = {
  apiKey: '',
  endpoint: DEFAULT_FETCH_ENDPOINT,
  delayMs: 500,
};

function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      apiKey: typeof parsed.apiKey === 'string' ? parsed.apiKey : '',
      endpoint: typeof parsed.endpoint === 'string' && parsed.endpoint.trim() ? parsed.endpoint : DEFAULT_FETCH_ENDPOINT,
      delayMs: Math.max(250, Math.min(10000, Number(parsed.delayMs) || 500)),
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeUrls(input: string): { urls: string[]; invalid: string[] } {
  const lines = input.split(/[\n\r]+/).map((line) => line.trim()).filter(Boolean);
  const urls: string[] = [];
  const invalid: string[] = [];
  const seen = new Set<string>();
  for (const line of lines) {
    try {
      const url = new URL(line);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') throw new Error('protocol');
      const normalized = url.toString();
      if (!seen.has(normalized)) {
        urls.push(normalized);
        seen.add(normalized);
      }
    } catch {
      invalid.push(line);
    }
  }
  return { urls, invalid };
}

function formatDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '刚刚';
  return new Intl.DateTimeFormat('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' }).format(date);
}

function App() {
  const [articles, setArticles] = useState<Article[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [settings, setSettings] = useState<Settings>(() => loadSettings());
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [showApiKey, setShowApiKey] = useState(false);
  const [urlInput, setUrlInput] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isTesting, setIsTesting] = useState(false);
  const [balance, setBalance] = useState<string | null>(null);
  const [balanceStatus, setBalanceStatus] = useState<'idle' | 'ok' | 'error'>('idle');
  const [previewMode, setPreviewMode] = useState<PreviewMode>('split');
  const [previewTheme, setPreviewTheme] = useState<PreviewTheme>('paper');
  const [toast, setToast] = useState<{ message: string; kind: 'success' | 'error' | 'info' } | null>(null);
  const [progress, setProgress] = useState({ done: 0, total: 0, currentUrl: '', failed: 0 });
  const [isExporting, setIsExporting] = useState(false);
  const controllerRef = useRef<AbortController | null>(null);
  const stopRef = useRef(false);
  const toastTimerRef = useRef<number | null>(null);

  const activeArticle = articles.find((article) => article.id === activeId) ?? null;
  const validUrlCount = normalizeUrls(urlInput).urls.length;
  const filteredArticles = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();
    if (!query) return articles;
    return articles.filter((article) => `${article.title} ${article.url} ${article.markdown}`.toLowerCase().includes(query));
  }, [articles, searchQuery]);
  const previewHtml = useMemo(() => {
    const source = activeArticle?.markdown ?? '';
    return DOMPurify.sanitize(String(marked.parse(source, { gfm: true, breaks: false })), {
      USE_PROFILES: { html: true },
    });
  }, [activeArticle?.markdown]);

  useEffect(() => {
    let cancelled = false;
    getArticles()
      .then((saved) => {
        if (cancelled) return;
        setArticles(saved);
        setActiveId(saved[0]?.id ?? null);
      })
      .catch((error: unknown) => {
        if (!cancelled) showToast(error instanceof Error ? error.message : '读取本地文章失败。', 'error');
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => {
      cancelled = true;
    };
    // Initial hydration only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!activeArticle || isLoading) return;
    const timer = window.setTimeout(() => {
      saveArticle(activeArticle).catch(() => showToast('本地保存失败，请检查浏览器存储空间。', 'error'));
    }, 450);
    return () => window.clearTimeout(timer);
    // Only persist fields that are editable in the workspace.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeArticle?.id, activeArticle?.title, activeArticle?.markdown, activeArticle?.url, isLoading]);

  useEffect(() => () => {
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    controllerRef.current?.abort();
  }, []);

  function showToast(message: string, kind: 'success' | 'error' | 'info' = 'info') {
    setToast({ message, kind });
    if (toastTimerRef.current !== null) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 3600);
  }

  function updateSettings<K extends keyof Settings>(key: K, value: Settings[K]) {
    setSettings((current) => ({ ...current, [key]: value }));
  }

  function persistSettings() {
    const next = { ...settings, delayMs: Math.max(250, Math.min(10000, Number(settings.delayMs) || 500)) };
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(next));
      setSettings(next);
      setSettingsOpen(false);
      showToast('配置已保存在当前浏览器。', 'success');
    } catch {
      showToast('配置保存失败，请检查浏览器存储设置。', 'error');
    }
  }

  async function testConnection() {
    if (!settings.apiKey.trim()) {
      showToast('请先填写 API Key。', 'error');
      return;
    }
    setIsTesting(true);
    setBalanceStatus('idle');
    try {
      const result = await fetchAccountBalance(settings.apiKey, settings.endpoint);
      setBalanceStatus('ok');
      setBalance(result.amount ? `${result.amount} ${result.currency ?? 'CNY'}` : result.available ? '账号可用' : '暂无可用额度');
      showToast('连接成功，已读取账号状态。', 'success');
    } catch (error) {
      setBalanceStatus('error');
      setBalance(null);
      const message = error instanceof Error ? error.message : '连接失败。';
      showToast(`${message} 若提示网络错误，也可能是浏览器 CORS 限制。`, 'error');
    } finally {
      setIsTesting(false);
    }
  }

  async function startCapture() {
    if (isRunning) return;
    if (!settings.apiKey.trim()) {
      setSettingsOpen(true);
      showToast('开始前需要配置 DeepSeek API Key。', 'info');
      return;
    }
    const { urls, invalid } = normalizeUrls(urlInput);
    if (invalid.length > 0) showToast(`已忽略 ${invalid.length} 条无效链接。`, 'info');
    if (urls.length === 0) {
      showToast('请先输入至少一个有效的 http / https 链接。', 'error');
      return;
    }

    stopRef.current = false;
    const controller = new AbortController();
    controllerRef.current = controller;
    setIsRunning(true);
    setProgress({ done: 0, total: urls.length, currentUrl: urls[0], failed: 0 });
    let failed = 0;
    let completed = 0;

    try {
      for (let index = 0; index < urls.length; index += 1) {
        if (stopRef.current) break;
        const url = urls[index];
        setProgress({ done: completed, total: urls.length, currentUrl: url, failed });
        try {
          const result = await fetchWebpageAsMarkdown(url, settings.apiKey, settings.endpoint, controller.signal);
          if (stopRef.current) break;
          const now = new Date().toISOString();
          const existing = articles.find((article) => article.url === url);
          const article: Article = {
            id: existing?.id ?? makeId(),
            url,
            title: result.title,
            markdown: result.markdown,
            createdAt: existing?.createdAt ?? now,
            updatedAt: now,
          };
          await saveArticle(article);
          setArticles((current) => [article, ...current.filter((item) => item.id !== article.id)]);
          setActiveId(article.id);
        } catch (error) {
          if (error instanceof DOMException && error.name === 'AbortError') break;
          failed += 1;
          const message = error instanceof Error ? error.message : '未知错误';
          showToast(`${new URL(url).hostname}：${message}`, 'error');
        }
        completed += 1;
        setProgress({ done: completed, total: urls.length, currentUrl: index + 1 < urls.length ? urls[index + 1] : '', failed });
        if (index + 1 < urls.length && !stopRef.current) {
          await new Promise((resolve) => window.setTimeout(resolve, Math.max(250, Number(settings.delayMs) || 500)));
        }
      }
      if (stopRef.current) showToast(`已停止抓取，完成 ${completed - failed} 篇，失败 ${failed} 篇。`, 'info');
      else if (failed === 0) showToast(`抓取完成，处理 ${completed} 个链接。`, 'success');
      else showToast(`抓取结束：完成 ${completed - failed} 篇，失败 ${failed} 篇。`, 'info');
      setUrlInput((current) => current.trim());
    } finally {
      setIsRunning(false);
      controllerRef.current = null;
      stopRef.current = false;
    }
  }

  function stopCapture() {
    stopRef.current = true;
    controllerRef.current?.abort();
  }

  async function removeArticle(article: Article) {
    try {
      await deleteArticle(article.id);
      const remaining = articles.filter((item) => item.id !== article.id);
      setArticles(remaining);
      if (activeId === article.id) setActiveId(remaining[0]?.id ?? null);
      showToast('文章已从本地库删除。', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '删除失败。', 'error');
    }
  }

  async function removeAllArticles() {
    if (!articles.length) return;
    if (!window.confirm(`确定清空本地文章库中的 ${articles.length} 篇文章吗？此操作无法撤销。`)) return;
    try {
      await clearArticles();
      setArticles([]);
      setActiveId(null);
      showToast('本地文章库已清空。', 'success');
    } catch (error) {
      showToast(error instanceof Error ? error.message : '清空失败。', 'error');
    }
  }

  function updateActiveArticle(patch: Partial<Pick<Article, 'title' | 'markdown'>>) {
    if (!activeId) return;
    setArticles((current) => current.map((article) => article.id === activeId
      ? { ...article, ...patch, updatedAt: new Date().toISOString() }
      : article));
  }

  async function exportCurrent() {
    if (!activeArticle) return;
    downloadText(`${safeFilename(activeArticle.title)}.md`, activeArticle.markdown);
    showToast('Markdown 文件已开始下载。', 'success');
  }

  async function exportAll() {
    if (!articles.length || isExporting) return;
    setIsExporting(true);
    try {
      await downloadArticlesIndividually(articles);
      showToast(`已发起 ${articles.length} 个 Markdown 文件的下载。`, 'success');
    } catch {
      showToast('批量下载失败，请尝试导出 ZIP。', 'error');
    } finally {
      setIsExporting(false);
    }
  }

  async function exportZip() {
    if (!articles.length || isExporting) return;
    setIsExporting(true);
    try {
      await downloadZip(articles);
      showToast(`已打包 ${articles.length} 篇文章。`, 'success');
    } catch {
      showToast('ZIP 打包失败，请稍后重试。', 'error');
    } finally {
      setIsExporting(false);
    }
  }

  async function copyMarkdown() {
    if (!activeArticle) return;
    try {
      await navigator.clipboard.writeText(activeArticle.markdown);
      showToast('Markdown 已复制到剪贴板。', 'success');
    } catch {
      showToast('浏览器未授予剪贴板权限，请手动复制编辑器内容。', 'error');
    }
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#top" aria-label="DeepSeek 网页转 Markdown 首页">
          <span className="brand-mark"><FileText size={20} strokeWidth={2.1} /></span>
          <span className="brand-copy">
            <strong>Web to Markdown</strong>
            <small>DEEPSEEK FETCH WORKSPACE</small>
          </span>
        </a>
        <div className="topbar-right">
          <div className="privacy-chip"><ShieldCheck size={14} /> 本地优先</div>
          <div className={`api-status ${settings.apiKey.trim() ? 'is-ready' : ''}`}>
            <span className="status-dot" />
            {settings.apiKey.trim() ? 'API 已配置' : '尚未配置 API'}
          </div>
          <button className="button button-primary button-compact" onClick={() => setSettingsOpen(true)}>
            <Settings2 size={16} /> 配置 API Key
          </button>
        </div>
      </header>

      <main id="top" className="main-content">
        <section className="page-intro">
          <div className="intro-copy">
            <div className="eyebrow"><Sparkles size={14} /> 阅读素材 · 本地知识库</div>
            <h1>把网页，整理成你的 <span>Markdown</span></h1>
            <p>批量抓取网页正文，随手编辑、即时预览，再保存到自己的知识库。</p>
          </div>
          <div className="intro-stats">
            <div className="stat-card">
              <span className="stat-icon"><BookOpen size={17} /></span>
              <span className="stat-value">{articles.length}</span>
              <span className="stat-label">已保存文章</span>
            </div>
            <div className="stat-card">
              <span className="stat-icon green"><HardDrive size={17} /></span>
              <span className="stat-value">本地</span>
              <span className="stat-label">浏览器存储</span>
            </div>
          </div>
        </section>

        <section className="workspace" aria-label="网页转 Markdown 工作区">
          <aside className="sidebar">
            <section className="panel capture-panel">
              <div className="panel-heading">
                <div className="panel-title-wrap">
                  <span className="section-icon purple"><Link2 size={16} /></span>
                  <div><h2>导入网页</h2><p>每行一个链接，支持批量抓取</p></div>
                </div>
                <span className="count-pill">{validUrlCount} 条</span>
              </div>
              <label className="sr-only" htmlFor="url-input">网页链接</label>
              <textarea
                id="url-input"
                className="url-textarea"
                value={urlInput}
                onChange={(event) => setUrlInput(event.target.value)}
                placeholder={'https://example.com/article-one\nhttps://example.com/article-two'}
                disabled={isRunning}
                spellCheck={false}
              />
              <div className="input-helper"><Globe2 size={13} /> 支持公开网页 · 自动识别重复链接</div>
              {isRunning && (
                <div className="progress-block">
                  <div className="progress-copy"><span>正在抓取</span><strong>{progress.done} / {progress.total}</strong></div>
                  <div className="progress-track"><span style={{ width: `${progress.total ? (progress.done / progress.total) * 100 : 0}%` }} /></div>
                  <div className="progress-url" title={progress.currentUrl}>{progress.currentUrl || '正在整理结果…'}</div>
                </div>
              )}
              <div className="capture-actions">
                {isRunning ? (
                  <button className="button button-danger button-full" onClick={stopCapture}><StopCircle size={16} /> 停止抓取</button>
                ) : (
                  <button className="button button-dark button-full" onClick={startCapture} disabled={!urlInput.trim()}>
                    <Zap size={16} /> 开始抓取 <ArrowRight size={16} />
                  </button>
                )}
              </div>
              <div className="api-footnote"><ShieldCheck size={13} /> 请求直接发送至配置的 API 地址，不经过本项目服务器。</div>
            </section>

            <section className="panel library-panel">
              <div className="panel-heading library-heading">
                <div className="panel-title-wrap">
                  <span className="section-icon blue"><Archive size={16} /></span>
                  <div><h2>文章库</h2><p>{isLoading ? '正在读取本地文章…' : `${articles.length} 篇已保存`}</p></div>
                </div>
                <button className="icon-button subtle" onClick={removeAllArticles} disabled={!articles.length || isRunning} title="清空文章库" aria-label="清空文章库"><Trash2 size={15} /></button>
              </div>
              <div className="search-box">
                <Search size={15} />
                <input value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} placeholder="搜索标题、链接或正文" aria-label="搜索文章" />
                {searchQuery && <button className="clear-search" onClick={() => setSearchQuery('')} aria-label="清除搜索"><X size={13} /></button>}
              </div>
              <div className="article-list">
                {isLoading ? (
                  <div className="list-empty"><LoaderCircle className="spin" size={22} /><span>正在读取本地文章</span></div>
                ) : filteredArticles.length === 0 ? (
                  <div className="list-empty">
                    <span className="empty-file-icon"><FileText size={22} /></span>
                    <strong>{searchQuery ? '没有匹配的文章' : '这里还空空的'}</strong>
                    <span>{searchQuery ? '试试其他关键词' : '抓取网页后，文章会自动保存在这里'}</span>
                  </div>
                ) : filteredArticles.map((article) => (
                  <div key={article.id} className={`article-row ${activeId === article.id ? 'active' : ''}`}>
                    <button className="article-select" onClick={() => setActiveId(article.id)}>
                      <span className="article-file"><FileText size={16} /></span>
                      <span className="article-meta">
                        <strong title={article.title}>{article.title || '未命名文章'}</strong>
                        <span title={article.url}>{article.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}</span>
                        <small><Clock3 size={11} /> {formatDate(article.updatedAt)}</small>
                      </span>
                    </button>
                    <button className="row-delete" onClick={() => void removeArticle(article)} aria-label={`删除 ${article.title}`} title="删除文章"><Trash2 size={14} /></button>
                  </div>
                ))}
              </div>
              <div className="library-foot"><HardDrive size={13} /> 自动保存在此浏览器，刷新后仍可继续编辑</div>
            </section>
          </aside>

          <section className="editor-panel panel">
            {!activeArticle ? (
              <div className="editor-empty">
                <div className="empty-illustration">
                  <div className="illustration-paper"><span /><span /><span /><i /></div>
                  <div className="illustration-arrow"><ArrowDownToLine size={21} /></div>
                  <div className="illustration-md">MD</div>
                </div>
                <h2>准备好整理下一篇了吗？</h2>
                <p>在左侧输入网页链接并开始抓取。内容会自动保存到本地，你可以随时回来继续编辑。</p>
                <button className="button button-outline" onClick={() => document.getElementById('url-input')?.focus()}><Plus size={16} /> 添加网页链接</button>
                <div className="empty-privacy"><ShieldCheck size={14} /> 你的文章保存在本地浏览器中</div>
              </div>
            ) : (
              <>
                <div className="editor-toolbar">
                  <div className="editor-breadcrumb">
                    <span className="breadcrumb-root">文章库</span><span className="breadcrumb-slash">/</span><span className="breadcrumb-current" title={activeArticle.title}>{activeArticle.title || '未命名文章'}</span>
                  </div>
                  <div className="toolbar-actions">
                    <button className="icon-button" onClick={() => void copyMarkdown()} title="复制 Markdown" aria-label="复制 Markdown"><Copy size={15} /></button>
                    <button className="button button-outline button-small" onClick={() => void exportCurrent()}><Download size={14} /> 导出 .md</button>
                  </div>
                </div>
                <div className="document-title-area">
                  <div className="document-title-icon"><FileText size={19} /></div>
                  <input
                    className="document-title-input"
                    value={activeArticle.title}
                    onChange={(event) => updateActiveArticle({ title: event.target.value })}
                    aria-label="文章标题"
                    placeholder="输入文章标题"
                  />
                  <span className="saved-indicator"><CheckCircle2 size={13} /> 本地自动保存</span>
                </div>
                <div className="document-meta-row">
                  <a href={activeArticle.url} target="_blank" rel="noreferrer" className="source-link"><ExternalLink size={12} /> {activeArticle.url}</a>
                  <span className="updated-time"><Clock3 size={12} /> 更新于 {formatDate(activeArticle.updatedAt)}</span>
                </div>
                <div className="editor-controls">
                  <div className="view-switch" role="group" aria-label="编辑视图">
                    <button className={previewMode === 'edit' ? 'selected' : ''} onClick={() => setPreviewMode('edit')}><Pencil size={14} /> 编辑</button>
                    <button className={previewMode === 'split' ? 'selected' : ''} onClick={() => setPreviewMode('split')}><span className="split-glyph"><i /><i /></span> 分栏</button>
                    <button className={previewMode === 'preview' ? 'selected' : ''} onClick={() => setPreviewMode('preview')}><EyeIcon /> 预览</button>
                  </div>
                  <div className="preview-options">
                    <span className="word-count">{activeArticle.markdown.length.toLocaleString()} 字符</span>
                    <label className="theme-select-wrap">
                      <span>主题</span>
                      <select value={previewTheme} onChange={(event) => setPreviewTheme(event.target.value as PreviewTheme)} aria-label="预览主题">
                        <option value="paper">纸感</option>
                        <option value="github">GitHub</option>
                        <option value="midnight">深色</option>
                      </select>
                      <ChevronDown size={12} />
                    </label>
                  </div>
                </div>
                <div className={`document-workspace mode-${previewMode} theme-${previewTheme}`}>
                  {(previewMode === 'edit' || previewMode === 'split') && (
                    <div className="markdown-editor-column">
                      <div className="column-heading"><span>MARKDOWN 原文</span><span className="live-dot" /> <span>自动保存</span></div>
                      <textarea
                        className="markdown-editor"
                        value={activeArticle.markdown}
                        onChange={(event) => updateActiveArticle({ markdown: event.target.value })}
                        aria-label="Markdown 原文编辑器"
                        spellCheck={false}
                      />
                    </div>
                  )}
                  {(previewMode === 'preview' || previewMode === 'split') && (
                    <div className="markdown-preview-column">
                      <div className="column-heading"><span>实时预览</span><span className="preview-ready"><Check size={12} /> 已同步</span></div>
                      <article className="markdown-preview" dangerouslySetInnerHTML={{ __html: previewHtml }} />
                    </div>
                  )}
                </div>
                <div className="editor-footer">
                  <span><ShieldCheck size={13} /> 内容只保存在本地浏览器</span>
                  <div className="footer-actions">
                    <button className="text-button" onClick={() => void copyMarkdown()}><Copy size={13} /> 复制内容</button>
                    <button className="text-button emphasized" onClick={() => void exportCurrent()}><Download size={13} /> 下载 Markdown</button>
                  </div>
                </div>
              </>
            )}
          </section>
        </section>

        <section className="export-strip">
          <div className="export-intro">
            <span className="export-icon"><FileArchive size={18} /></span>
            <div><strong>整理完成，带走你的内容</strong><span>将文章导出到 Obsidian、Notion 或任何 Markdown 工具。</span></div>
          </div>
          <div className="export-actions">
            <button className="button button-outline" onClick={() => void exportCurrent()} disabled={!activeArticle}><Download size={15} /> 当前文章</button>
            <button className="button button-outline" onClick={() => void exportAll()} disabled={!articles.length || isExporting}>{isExporting ? <LoaderCircle className="spin" size={15} /> : <FileText size={15} />} 逐篇导出全部</button>
            <button className="button button-primary" onClick={() => void exportZip()} disabled={!articles.length || isExporting}><Archive size={15} /> 打包导出 ZIP</button>
          </div>
        </section>

        <footer className="app-footer">
          <span>DEEPSEEK WEB TO MARKDOWN <span className="footer-dot">·</span> 独立实现</span>
          <span className="footer-note"><ShieldCheck size={12} /> API Key 与文章均保存在本地</span>
          <a href="https://platform.deepseek.com/" target="_blank" rel="noreferrer">DeepSeek API <ExternalLink size={11} /></a>
        </footer>
      </main>

      {settingsOpen && (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setSettingsOpen(false); }}>
          <section className="settings-modal" role="dialog" aria-modal="true" aria-labelledby="settings-title">
            <div className="modal-heading">
              <div className="modal-heading-icon"><KeyRound size={20} /></div>
              <div><h2 id="settings-title">DeepSeek API 配置</h2><p>连接网页抓取能力，配置仅保存在当前浏览器。</p></div>
              <button className="icon-button modal-close" onClick={() => setSettingsOpen(false)} aria-label="关闭配置"><X size={17} /></button>
            </div>
            <div className="privacy-callout"><ShieldCheck size={17} /><span><strong>你的 Key 由你掌控</strong><small>API Key 保存在 localStorage。请求直接发送到下方配置的 API 地址，不会经过本项目的服务器。</small></span></div>
            <div className="form-field">
              <label htmlFor="api-key">API Key <span className="required-mark">*</span></label>
              <div className="key-input-wrap">
                <KeyRound size={16} />
                <input id="api-key" type={showApiKey ? 'text' : 'password'} value={settings.apiKey} onChange={(event) => updateSettings('apiKey', event.target.value)} placeholder="粘贴你的 DeepSeek API Key" autoComplete="off" />
                <button className="inline-action" onClick={() => setShowApiKey((value) => !value)}>{showApiKey ? '隐藏' : '显示'}</button>
              </div>
              <div className="field-hint">没有 Key？<a href="https://platform.deepseek.com/" target="_blank" rel="noreferrer">前往 DeepSeek 控制台 <ExternalLink size={11} /></a></div>
            </div>
            <div className="form-field">
              <label htmlFor="api-endpoint">Fetch 请求地址</label>
              <input id="api-endpoint" className="text-input" value={settings.endpoint} onChange={(event) => updateSettings('endpoint', event.target.value)} placeholder={DEFAULT_FETCH_ENDPOINT} />
              <div className="field-hint">默认使用 DeepSeek Fetch API。可填写你自己配置的兼容代理地址。</div>
            </div>
            <div className="form-field">
              <div className="label-with-value"><label htmlFor="delay-ms">请求间隔</label><strong>{Math.max(250, Number(settings.delayMs) || 500)} ms</strong></div>
              <input id="delay-ms" className="range-input" type="range" min="250" max="3000" step="50" value={Math.max(250, Math.min(3000, Number(settings.delayMs) || 500))} onChange={(event) => updateSettings('delayMs', Number(event.target.value))} />
              <div className="range-labels"><span>250 ms · 较快</span><span>3,000 ms · 更稳妥</span></div>
            </div>
            <div className="pricing-note"><Zap size={15} /><span><strong>注意 API 用量</strong><small>Fetch 调用可能产生费用。批量抓取前请确认账号额度，并使用合适的请求间隔。</small></span></div>
            <div className="cors-note"><CircleHelp size={15} /><span>如果浏览器提示网络错误，可能是 API 的 CORS 限制。可在兼容的本地代理或跨域环境中运行本工具。</span></div>
            {balanceStatus === 'ok' && <div className="connection-result success"><CheckCircle2 size={15} /> 连接成功：{balance ?? '账号可用'}</div>}
            {balanceStatus === 'error' && <div className="connection-result error"><AlertCircle size={15} /> 上次连接失败，请检查 Key、网络或 CORS 配置。</div>}
            <div className="modal-actions">
              <button className="button button-quiet" onClick={() => { const cleared = { ...settings, apiKey: '' }; setSettings(cleared); localStorage.setItem(SETTINGS_KEY, JSON.stringify(cleared)); setBalance(null); setBalanceStatus('idle'); showToast('已清除本地保存的 API Key。', 'success'); }}>清空 Key</button>
              <div className="modal-actions-right">
                <button className="button button-outline" onClick={() => void testConnection()} disabled={isTesting || !settings.apiKey.trim()}>{isTesting ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />} 测试连接</button>
                <button className="button button-primary" onClick={persistSettings}><Check size={15} /> 保存配置</button>
              </div>
            </div>
          </section>
        </div>
      )}

      {toast && (
        <div className={`toast toast-${toast.kind}`} role="status">
          {toast.kind === 'success' ? <CheckCircle2 size={17} /> : toast.kind === 'error' ? <AlertCircle size={17} /> : <CircleHelp size={17} />}
          <span>{toast.message}</span>
          <button onClick={() => setToast(null)} aria-label="关闭通知"><X size={14} /></button>
        </div>
      )}
    </div>
  );
}

function EyeIcon() {
  return <span className="eye-glyph" aria-hidden="true">◉</span>;
}

export default App;
