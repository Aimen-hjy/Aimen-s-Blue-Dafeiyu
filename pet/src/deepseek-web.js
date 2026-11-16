// DeepSeek 网页端(chat.deepseek.com)内部接口 + PoW，供 chat 模式使用。
// 参考 Wu-jiyan/deepseek-reverse-api (MIT)。DeepSeekHashV1 = 跳过第 0 轮的 Keccak-256(SHA3-256)。
const fs = require('node:fs');
const path = require('node:path');
const { net } = require('electron');

const BASE = 'https://chat.deepseek.com/api';

const HEADERS = {
  Accept: '*/*',
  'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
  Origin: 'https://chat.deepseek.com',
  Referer: 'https://chat.deepseek.com/',
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/147.0.0.0 Safari/537.36 Edg/147.0.0.0',
  'X-App-Version': '20241129.1',
  'X-Client-Locale': 'zh_CN',
  'X-Client-Platform': 'web',
  'X-Client-Version': '1.8.0',
};

// —— PoW (DeepSeekHashV1) ——
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
    target_path: '/api/v0/chat/completion',
  };
  return Buffer.from(JSON.stringify(obj)).toString('base64');
}

// —— 接口流程 ——
async function apiJson(urlPath, token, method, body) {
  const res = await net.fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      ...HEADERS,
      Authorization: `Bearer ${token}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {}
  return { status: res.status, data };
}

function bizData(data) {
  return (data && data.data && data.data.biz_data) || (data && data.biz_data) || null;
}

async function acquireAccessToken(userToken) {
  const { status, data } = await apiJson('/v0/users/current', userToken, 'GET');
  if (status !== 200) throw new Error(`user_token 无效或过期（HTTP ${status}），请重新获取`);
  const bd = bizData(data);
  if (!bd || !bd.token) throw new Error(`获取访问令牌失败：${(data && data.msg) || '未知错误'}`);
  return bd.token;
}

async function createSession(accessToken) {
  const { status, data } = await apiJson('/v0/chat_session/create', accessToken, 'POST', {
    character_id: null,
  });
  if (status !== 200) throw new Error(`创建会话失败（HTTP ${status}）`);
  const bd = bizData(data);
  const id = bd && (bd.chat_session && bd.chat_session.id) || bd && bd.id;
  if (!id) throw new Error('创建会话失败：未返回会话 id');
  return id;
}

async function getChallenge(accessToken) {
  const { status, data } = await apiJson('/v0/chat/create_pow_challenge', accessToken, 'POST', {
    target_path: '/api/v0/chat/completion',
  });
  if (status !== 200) throw new Error(`获取 PoW 挑战失败（HTTP ${status}）`);
  const bd = bizData(data);
  if (!bd || !bd.challenge) throw new Error('获取 PoW 挑战失败：无 challenge');
  return bd.challenge;
}

function extractText(p) {
  let out = '';
  if (p.v && typeof p.v === 'object' && p.v.response) {
    const frags = p.v.response.fragments || [];
    for (const f of frags) {
      if (f.type === 'ANSWER' || f.type === 'RESPONSE') out += f.content || '';
    }
  } else if (p.p === 'response/fragments' && Array.isArray(p.v)) {
    for (const f of p.v) {
      if (f.type === 'ANSWER' || f.type === 'RESPONSE') out += f.content || '';
    }
  } else if (typeof p.v === 'string') {
    out += p.v;
  }
  return out;
}

async function sendCompletion(accessToken, sessionId, prompt, powResp) {
  const res = await net.fetch(`${BASE}/v0/chat/completion`, {
    method: 'POST',
    headers: {
      ...HEADERS,
      'Content-Type': 'application/json',
      Authorization: `Bearer ${accessToken}`,
      'X-Ds-Pow-Response': powResp,
    },
    body: JSON.stringify({
      chat_session_id: sessionId,
      parent_message_id: null,
      model_type: 'default',
      prompt,
      ref_file_ids: [],
      thinking_enabled: false,
      search_enabled: false,
      preempt: false,
    }),
  });
  if (res.status !== 200) throw new Error(`对话请求失败（HTTP ${res.status}）`);
  const text = await res.text();
  let out = '';
  for (const line of text.split('\n')) {
    const s = line.trim();
    if (!s.startsWith('data:')) continue;
    const d = s.slice(5).trim();
    if (!d || d === '[DONE]') continue;
    try {
      out += extractText(JSON.parse(d));
    } catch {}
  }
  return out;
}

/** 用 user_token 走网页端发一条消息，返回完整回复文本（非流式）。 */
async function webChat(userToken, prompt) {
  const accessToken = await acquireAccessToken(userToken);
  const sessionId = await createSession(accessToken);
  const challenge = await getChallenge(accessToken);
  const powResp = powHeader(challenge);
  const text = await sendCompletion(accessToken, sessionId, prompt, powResp);
  const cleaned = text.replace(/FINISHED/g, '').trim();
  if (!cleaned) throw new Error('未读取到回复');
  return cleaned;
}

module.exports = { webChat };
