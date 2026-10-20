export const DEFAULT_FETCH_ENDPOINT = 'https://api.deepseek.com/v1/tools/fetch';

export interface FetchResult {
  title: string;
  markdown: string;
}

function pickString(...values: unknown[]): string | undefined {
  return values.find((value): value is string => typeof value === 'string' && value.trim().length > 0)?.trim();
}

function extractResult(payload: unknown, fallbackTitle: string): FetchResult {
  if (!payload || typeof payload !== 'object') {
    throw new Error('接口返回内容不是有效的 JSON 对象。');
  }

  const data = payload as Record<string, any>;
  const nested = [data.data, data.result, data.output].find((value) => value && typeof value === 'object') ?? {};
  const choiceText = data.choices?.[0]?.message?.content;
  const markdown = pickString(
    data.markdown,
    data.content,
    data.text,
    data.article,
    nested.markdown,
    nested.content,
    nested.text,
    nested.article,
    choiceText,
  );

  if (!markdown) {
    const detail = pickString(data.message, data.error?.message, nested.message);
    throw new Error(detail ? `接口未返回 Markdown：${detail}` : '接口没有返回可用的正文内容，请检查 Fetch API 的响应格式。');
  }

  const title = pickString(data.title, nested.title, data.name, nested.name) ?? fallbackTitle;
  return { title, markdown };
}

export async function fetchWebpageAsMarkdown(
  url: string,
  apiKey: string,
  endpoint: string,
  signal: AbortSignal,
): Promise<FetchResult> {
  const response = await fetch(endpoint, {
    method: 'POST',
    signal,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey.trim()}`,
    },
    body: JSON.stringify({ url }),
  });

  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    const data = payload && typeof payload === 'object' ? (payload as Record<string, any>) : {};
    const message = pickString(data.message, data.error?.message, data.error, data.detail);
    if (response.status === 401 || response.status === 403) {
      throw new Error('API Key 无效或没有调用权限，请检查 Key 与账号状态。');
    }
    if (response.status === 429) {
      throw new Error('请求过于频繁或额度不足，请增大并发间隔后重试。');
    }
    throw new Error(message ?? `Fetch 请求失败（HTTP ${response.status}）。`);
  }

  let fallbackTitle = url;
  try {
    fallbackTitle = new URL(url).hostname.replace(/^www\./, '');
  } catch {
    // The URL is validated before it reaches this function.
  }
  return extractResult(payload, fallbackTitle);
}

export interface BalanceResult {
  available: boolean;
  currency?: string;
  amount?: string;
}

export async function fetchAccountBalance(apiKey: string, endpoint: string): Promise<BalanceResult> {
  const endpointUrl = new URL(endpoint);
  const balanceUrl = `${endpointUrl.origin}/user/balance`;
  const response = await fetch(balanceUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey.trim()}` },
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`余额查询失败（HTTP ${response.status}）。`);
  }

  const data = payload && typeof payload === 'object' ? (payload as Record<string, any>) : {};
  const firstBalance = Array.isArray(data.balance_infos) ? data.balance_infos[0] : undefined;
  const amount = firstBalance?.total_balance ?? firstBalance?.granted_balance ?? data.total_balance;
  const currency = firstBalance?.currency ?? 'CNY';
  return {
    available: Boolean(data.is_available ?? true),
    currency: typeof currency === 'string' ? currency : 'CNY',
    amount: amount === undefined || amount === null ? undefined : String(amount),
  };
}
