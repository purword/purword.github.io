// Cloudflare Pages Function：把浏览器对 /api/gitee/* 的请求中继到 gitee 开放 API，
// 并补上 CORS 响应头，从而绕开浏览器对直连 gitee.com 的跨域限制（CORS）。
//
// 为什么需要它：浏览器里的写作工具直接 fetch gitee.com 会被 CORS 拦（报 Failed to fetch），
// 因为 gitee 的 API 不返回 Access-Control-Allow-Origin。这个 Function 跑在 Cloudflare 边缘
// （服务端，没有浏览器 CORS 限制），由它去调 gitee，再给浏览器回一头 CORS，浏览器就放行了。
//
// 安全约束：只转发到 gitee.com/api/v5 且路径必须以 /repos/ 开头，避免被当通用开放代理滥用。

const GITEE_BASE = 'https://gitee.com/api/v5';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

export async function onRequest(context) {
  const { request } = context;
  const url = new URL(request.url);

  // 仅放行约定方法
  if (!['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'].includes(request.method)) {
    return new Response('Method Not Allowed', { status: 405, headers: CORS });
  }
  // 浏览器预检（带 Authorization 头会触发 OPTIONS）直接放行
  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS });
  }

  // 还原 gitee 目标地址：去掉 /api/gitee 前缀，拼回 gitee 基础地址
  const giteePath = url.pathname.replace(/^\/api\/gitee/, '') || '/';
  if (!giteePath.startsWith('/repos/')) {
    return new Response('Forbidden: only /repos/ allowed', { status: 403, headers: CORS });
  }
  const target = new URL(GITEE_BASE + giteePath);
  target.search = url.search; // 原样转发 query（含 access_token / ref 等）

  // 转发请求头，丢弃 host，保留 Authorization / Content-Type 等
  const headers = {};
  for (const [k, v] of request.headers) {
    if (k.toLowerCase() === 'host') continue;
    headers[k] = v;
  }

  const init = { method: request.method, headers };
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    init.body = request.body; // ReadableStream，直接透传
  }

  try {
    const resp = await fetch(target.toString(), init);
    const out = new Response(resp.body, resp); // 透传 gitee 的状态/响应体
    for (const [k, v] of Object.entries(CORS)) out.headers.set(k, v); // 补 CORS
    return out;
  } catch (e) {
    return new Response('Relay error: ' + e.message, { status: 502, headers: CORS });
  }
}
