// Story pREST browser client (read operations only).
// Override window.STORY_API_URL before this script when a different endpoint is needed.
const PREST_API_BASE = (window.STORY_API_URL || 'https://story-api.xirizhi.cn/story/public').replace(/\/$/, '');

async function fetchData(tableName, options = {}) {
  try {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(tableName)) {
      throw new Error('非法表名');
    }

    const params = new URLSearchParams();
    if (options.columns && options.columns !== '*') {
      params.set('_select', options.columns);
    }
    for (const [column, value] of Object.entries(options.filter || {})) {
      params.set(column, value);
    }
    for (const [column, value] of Object.entries(options.filterLike || {})) {
      params.set(column, `$ilike.%${value}%`);
    }
    if (options.orderBy) {
      const { column, ascending = true } = options.orderBy;
      params.set('_order', `${ascending ? '' : '-'}${column}`);
    }
    if (options.pagination) {
      params.set('_page', options.pagination.page);
      params.set('_page_size', options.pagination.pageSize);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), options.timeout || 20000);
    try {
      const response = await fetch(`${PREST_API_BASE}/${tableName}?${params}`, {
        headers: { Accept: 'application/json' },
        signal: controller.signal
      });
      if (!response.ok) {
        throw new Error(`pREST 请求失败: HTTP ${response.status}`);
      }
      return { data: await response.json(), error: null };
    } finally {
      clearTimeout(timer);
    }
  } catch (error) {
    console.error('pREST 查询错误:', error);
    return { data: null, error };
  }
}

window.prestClient = { fetchData };
