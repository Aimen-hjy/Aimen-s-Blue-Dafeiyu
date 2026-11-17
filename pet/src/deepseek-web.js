// DeepSeek 网页端(chat.deepseek.com)内部接口 + PoW，供 chat 模式使用。
// 参考 kittors/deepseek-web-api (MIT)：userToken 直接作 Bearer，SSE 流式解析，
// THINK→思考 / RESPONSE→正文分流，parent_message_id 续聊，模型/思考开关可配。
const fs = require('node:fs');
const path = require('node:path');
const { net } = require('electron');

const BASE = 'https://chat.deepseek.com';
const COMPLETION_PATH = '/api/v0/chat/completion';

const CLIENT_HEADERS = {
  'x-client-platform': 'web',
  'x-client-version': '2.2.0',
  'x-client-locale': 'zh_CN',
  'x-client-bundle-id': 'com.deepseek.chat',
};

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0';

// —— 调试：DEEPSEEK_WEB_DEBUG=1 时把上游 SSE 原始事件写入 pet/data/webchat-debug.log ——
const DEBUG_LOG = process.env.DEEPSEEK_WEB_DEBUG === '1'
  ? path.join(__dirname, '..', 'data', 'webchat-debug.log')
  : null;
function debugEvent(event, data) {
  if (!DEBUG_LOG) return;
  try {
    fs.appendFileSync(DEBUG_LOG, `${new Date().toISOString()} [${event || '-'}] ${JSON.stringify(data)}\n`);
  } catch {}
}

// —— PoW (DeepSeekHashV1) ——
// DeepSeekHashV1 = 跳过第 0 轮的 Keccak-256(SHA3-256)。本地 wasm 暴力求解 nonce。
let _pow = null;

function pow() {
  if (_pow) return _pow;
  const bytes = fs.readFileSync(path.join(__dirname, 'deepseek_pow.wasm'));
  const inst = new WebAssembly.Instance(new WebAssembly.Module(bytes), {});
  _pow = inst.exports;
  return _pow;
}

function encodeWasm(ex, text) {
  const buf = Buffer.from(text, 'utf8');
  const ptr = ex.__wbindgen_export_0(buf.length, 1) >>> 0;
  new Uint8Array(ex.memory.buffer, ptr, buf.length).set(buf);
  return [ptr, buf.length];
}

/** 暴力搜索 nonce ∈ [0, difficulty)，使 DeepSeekHashV1(salt_expireat_nonce) 的 hex 等于 challenge。 */
function solveChallenge(challenge) {
  const ex = pow();
  const prefix = `${challenge.salt}_${challenge.expire_at}_`;
  const retptr = ex.__wbindgen_add_to_stack_pointer(-16) >>> 0;
  const [p0, l0] = encodeWasm(ex, challenge.challenge);
  const [p1, l1] = encodeWasm(ex, prefix);
  ex.wasm_solve(retptr, p0, l0, p1, l1, Number(challenge.difficulty));
  const status = new Int32Array(ex.memory.buffer, retptr, 1)[0];
  const value = new Float64Array(ex.memory.buffer, retptr + 8, 1)[0];
  ex.__wbindgen_add_to_stack_pointer(16);
  if (status === 0) throw new Error('PoW 计算失败');
  return Math.trunc(value);
}

function powHeader(challenge) {
  const answer = solveChallenge(challenge);
  const obj = {
    algorithm: challenge.algorithm,
    challenge: challenge.challenge,
    salt: challenge.salt,
    answer,
    signature: challenge.signature,
    target_path: COMPLETION_PATH,
  };
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

// —— 基础接口 ——
function isRecord(v) {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

async function apiJson(urlPath, token, method, body, cookie) {
  const res = await net.fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      ...CLIENT_HEADERS,
      authorization: `Bearer ${token}`,
      ...(body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      origin: BASE,
      referer: `${BASE}/`,
      'user-agent': USER_AGENT,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await res.text();
  let data = null;
  try {
    data = raw ? JSON.parse(raw) : null;
  } catch {}
  return {
    status: res.status,
    redirected: !!res.redirected,
    finalUrl: res.url || '',
    data,
    raw: raw && raw.length > 300 ? raw.slice(0, 300) + '…' : raw,
  };
}

function bizData(data) {
  return (data && data.data && data.data.biz_data) || (data && data.biz_data) || null;
}

/** 把响应体截断成可读的错误信息（排查业务错误用）。 */
function brief(data) {
  try {
    const s = JSON.stringify(data);
    return s && s.length > 400 ? s.slice(0, 400) + '…' : s;
  } catch {
    return String(data);
  }
}

/** 组装诊断信息：优先 JSON，其次原始文本，再标注重定向/空响应。 */
function diag(r) {
  const parts = [];
  if (r.redirected) parts.push(`重定向到 ${r.finalUrl}`);
  if (r.data != null) parts.push(brief(r.data));
  else if (r.raw) parts.push(`非JSON响应：${r.raw}`);
  else parts.push('空响应');
  return parts.join('；');
}

/**
 * 用 user_token 换访问令牌（旧流程，见 /v0/users/current 的 biz_data.token）。
 * 换不到就退回直接使用 user_token（kittors/deepseek-web-api 的做法），
 * 两种 token 谁可用就用谁，失败信息带响应体便于排查。
 */
async function resolveToken(userToken, cookie) {
  try {
    const r = await apiJson('/api/v0/users/current', userToken, 'GET', null, cookie);
    if (r.status === 200) {
      const bd = bizData(r.data);
      if (bd && bd.token) {
        console.log('[webchat] 已通过 /v0/users/current 换取访问令牌');
        return bd.token;
      }
      console.warn(`[webchat] /v0/users/current 未返回 token，退回直接使用 user_token（${diag(r)}）`);
    } else {
      console.warn(`[webchat] /v0/users/current HTTP ${r.status}，退回直接使用 user_token（${diag(r)}）`);
    }
  } catch (e) {
    console.warn(`[webchat] /v0/users/current 请求异常，退回直接使用 user_token：${(e && e.message) || e}`);
  }
  return userToken;
}

async function createSession(token, cookie) {
  const r = await apiJson('/api/v0/chat_session/create', token, 'POST', {}, cookie);
  if (r.status !== 200) throw new Error(`创建会话失败（HTTP ${r.status}）：${diag(r)}`);
  const bd = bizData(r.data);
  const id = (bd && bd.chat_session && bd.chat_session.id) || (bd && bd.id);
  if (!id) throw new Error(`创建会话失败：未返回会话 id —— ${diag(r)}`);
  return id;
}

async function getChallenge(token, cookie) {
  const r = await apiJson('/api/v0/chat/create_pow_challenge', token, 'POST', {
    target_path: COMPLETION_PATH,
  }, cookie);
  if (r.status !== 200) throw new Error(`获取 PoW 挑战失败（HTTP ${r.status}）：${diag(r)}`);
  const bd = bizData(r.data);
  if (!bd || !bd.challenge) throw new Error(`获取 PoW 挑战失败：无 challenge —— ${diag(r)}`);
  return bd.challenge;
}

// —— SSE 流解析 ——
// 网页端是 JSON-patch 风格的 SSE：data 里带 p/o/v 字段，或 data.v.response.fragments
// 里带 THINK/RESPONSE 片段。网络分块可能把一条 SSE 拆成两半，所以用有状态缓冲解析。

function parseBlock(block) {
  if (!block.trim()) return null;
  let event = null;
  const dataLines = [];
  for (const line of block.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trimStart());
  }
  if (!dataLines.length) return null;
  try {
    const data = JSON.parse(dataLines.join('\n'));
    return isRecord(data) ? { event, data } : null;
  } catch {
    return null;
  }
}

function createSseParser() {
  let buf = '';
  return {
    push(chunk) {
      const events = [];
      buf += chunk;
      while (true) {
        const m = /\r?\n\r?\n/.exec(buf);
        if (!m || m.index === undefined) break;
        const block = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        const ev = parseBlock(block);
        if (ev) events.push(ev);
      }
      return events;
    },
    finish() {
      const ev = parseBlock(buf);
      buf = '';
      return ev ? [ev] : [];
    },
  };
}

function fragmentsOf(value) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

/**
 * 处理一条 SSE 事件，更新流上下文。ctx.current 追踪当前片段通道（思考/正文），
 * 防止只有 content 的 APPEND 补丁把思考内容误归到正文。
 */
function processEvent(event, data, ctx) {
  debugEvent(event, data);
  if (event === 'ready') {
    ctx.requestMessageId = data.request_message_id ?? ctx.requestMessageId;
    ctx.responseMessageId = data.response_message_id ?? ctx.responseMessageId;
    return;
  }
  if (event === 'title') return;
  if (event === 'close') {
    ctx.closed = true;
    return;
  }

  const nested = isRecord(data.v) && isRecord(data.v.response) ? data.v.response : null;
  if (nested) {
    for (const f of fragmentsOf(nested.fragments)) emitFragment(f, ctx);
    if (typeof nested.accumulated_token_usage === 'number') {
      ctx.tokens = nested.accumulated_token_usage;
    }
    return;
  }

  if (data.p === 'response/fragments' && data.o === 'APPEND') {
    for (const f of fragmentsOf(data.v)) emitFragment(f, ctx);
    return;
  }

  const isContentAppend = data.p === 'response/fragments/-1/content' && data.o === 'APPEND';
  const isRootAppend = data.p === undefined && data.o === 'APPEND' && data.v !== undefined;
  const isBareString = data.p === undefined && data.o === undefined && typeof data.v === 'string';
  if (isContentAppend || isRootAppend || isBareString) {
    const delta = String(data.v ?? '');
    if (delta) {
      if (ctx.current === 'output') {
        ctx.output += delta;
        ctx.onToken({ type: 'text', text: delta });
      } else {
        ctx.reasoning += delta;
        ctx.onToken({ type: 'thinking', text: delta });
      }
    }
    return;
  }

  if (data.p === 'response' && data.o === 'BATCH' && Array.isArray(data.v)) {
    for (const p of data.v) {
      if (isRecord(p) && p.p === 'accumulated_token_usage' && typeof p.v === 'number') {
        ctx.tokens = p.v;
      }
    }
  }
}

function emitFragment(f, ctx) {
  const type = typeof f.type === 'string' ? f.type : '';
  const content = typeof f.content === 'string' ? f.content : '';
  if (type === 'THINK') {
    ctx.current = 'reasoning';
    if (content) {
      ctx.reasoning += content;
      ctx.onToken({ type: 'thinking', text: content });
    }
    return;
  }
  if (type === 'SEARCH' || type === 'SEARCH_REF') {
    // 联网搜索：并入思考通道，不污染正文
    const s = content ? `\n[search] ${content}\n` : '\n[search]\n';
    ctx.reasoning += s;
    ctx.onToken({ type: 'thinking', text: s });
    return;
  }
  // 其余片段（RESPONSE / ANSWER / TEXT 等）一律视为正文，避免答案被误归到思考通道
  if (content) {
    ctx.current = 'output';
    ctx.output += content;
    ctx.onToken({ type: 'text', text: content });
  }
}

/** 发送一次流式补全，返回 { text, reasoning, output, responseMessageId, tokens }。 */
async function streamCompletion(token, sessionId, prompt, powResp, opts, onToken) {
  const { modelType, thinking, search, parentMessageId, cookie } = opts;
  const res = await net.fetch(`${BASE}${COMPLETION_PATH}`, {
    method: 'POST',
    headers: {
      ...CLIENT_HEADERS,
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'x-ds-pow-response': powResp,
      ...(cookie ? { cookie } : {}),
      origin: BASE,
      referer: `${BASE}/a/chat/s/${sessionId}`,
      'user-agent': USER_AGENT,
    },
    body: JSON.stringify({
      chat_session_id: sessionId,
      parent_message_id: parentMessageId,
      model_type: modelType,
      prompt,
      ref_file_ids: [],
      thinking_enabled: thinking,
      search_enabled: search,
      action: null,
      preempt: false,
    }),
  });
  if (!res.ok) {
    const msg = (await res.text()).slice(0, 500);
    throw new Error(`对话请求失败（HTTP ${res.status}）${msg ? '：' + msg : ''}`);
  }
  if (!res.body) throw new Error('上游未返回响应流');

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  const parser = createSseParser();
  const ctx = {
    current: 'reasoning',
    reasoning: '',
    output: '',
    requestMessageId: null,
    responseMessageId: null,
    tokens: 0,
    closed: false,
    onToken,
  };
  const process = (events) => {
    for (const { event, data } of events) processEvent(event, data, ctx);
  };

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    process(parser.push(decoder.decode(value, { stream: true })));
    if (ctx.closed) break;
  }
  process(parser.push(decoder.decode()));
  process(parser.finish());

  // 正文（RESPONSE）优先；DeepSeek 偶尔把最终答案只放在 THINK、没有 RESPONSE 片段，
  // 此时把思考内容提升为正文，避免空回复（同 deepseek-web-api 的 promotedReasoning）。
  // 正常情况下 THINK+RESPONSE 都在，只有 RESPONSE 作为答案返回，思考内容仍被隐藏。
  const finalText = ctx.output.trim() ? ctx.output : ctx.reasoning;
  return {
    text: finalText.trim(),
    reasoning: ctx.reasoning.trim(),
    output: ctx.output.trim(),
    requestMessageId: ctx.requestMessageId,
    responseMessageId: ctx.responseMessageId,
    tokens: ctx.tokens,
  };
}

// —— 多轮会话状态（网页端在服务端记住上下文，靠 parent_message_id 续聊）——
let sessionId = null;
let parentMessageId = null;

/** 清空多轮会话（新建对话）。 */
function resetWebChat() {
  sessionId = null;
  parentMessageId = null;
}

/**
 * 用 userToken 走网页端发一条消息，流式回传思考/正文 token。
 * opts: { onToken({type:'thinking'|'text', text}), modelType='default'|'expert',
 *         thinking=true, search=false }。
 * 返回 { text, reasoning, output, sessionId, tokens }。
 */
async function webChat(userToken, prompt, opts = {}) {
  const cookie = opts.cookie || null;
  const token = await resolveToken(userToken, cookie);
  if (!sessionId) {
    sessionId = await createSession(token, cookie);
    parentMessageId = null;
  }
  const challenge = await getChallenge(token, cookie);
  const powResp = powHeader(challenge);
  const onToken = opts.onToken || (() => {});
  const result = await streamCompletion(
    token,
    sessionId,
    prompt,
    powResp,
    {
      modelType: opts.modelType || 'default',
      thinking: !!opts.thinking,
      search: !!opts.search,
      parentMessageId,
      cookie,
    },
    onToken
  );
  parentMessageId = result.responseMessageId ?? parentMessageId;
  return { ...result, sessionId };
}

module.exports = { webChat, resetWebChat };
