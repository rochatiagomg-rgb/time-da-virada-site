// Only the municipal datasets used by the public site can be served.
const STATES = new Set('ac al am ap ba ce df es go ma mg ms mt pa pb pe pi pr rj rn ro rr rs sc se sp to'.split(' '));
export function allowedPath(path) {
  if (path === 'index.json') return true;
  const match = path.match(/^(?:locais\/)?([a-z]{2})\/([0-9]{2})\.json$/);
  return !!match && STATES.has(match[1]);
}
function error(status, message) {
  return Response.json({error:message}, {status, headers:{'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
}
export async function onRequest(context) {
  const {request, env} = context;
  if (!['GET','HEAD'].includes(request.method)) return error(405, 'Método não permitido.');
  const url = new URL(request.url);
  const path = url.pathname.slice('/api/dados/'.length);
  if (!url.pathname.startsWith('/api/dados/') || !allowedPath(path) || url.search) return error(404, 'Arquivo não disponível.');
  if (!env.GITHUB_DATA_TOKEN) return error(503, 'A consulta de resultados está aguardando a configuração de acesso à base de dados.');
  const token = String(env.GITHUB_DATA_TOKEN).trim();
  if (!/^github_pat_[A-Za-z0-9_]+$/.test(token)) return error(503, 'O segredo GITHUB_DATA_TOKEN não contém um token fine-grained válido. Cole somente o código gerado pelo GitHub.');
  const cacheKey = new Request(url.origin + '/api/dados/' + path, {method:'GET'});
  const edgeCache = globalThis.caches?.default;
  const cached = edgeCache && await edgeCache.match(cacheKey);
  if (cached) return request.method === 'HEAD' ? new Response(null, cached) : cached;
  let upstream;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15000);
  try {
    upstream = await fetch('https://api.github.com/repos/rochatiagomg-rgb/time-da-virada-dados/contents/' + path + '?ref=main', {
      headers:{
        'Authorization':'Bearer ' + token,
        'Accept':'application/vnd.github.raw+json',
        'X-GitHub-Api-Version':'2022-11-28',
        'User-Agent':'Time-da-Virada-Pages'
      },
      redirect:'manual',
      signal:controller.signal
    });
  } catch (failure) {
    const type = failure?.name === 'AbortError' ? 'tempo de espera esgotado' : failure?.name === 'TypeError' ? 'falha na chamada ao GitHub' : 'falha de conexão';
    return error(502, 'A base de resultados está temporariamente indisponível (' + type + '). Tente novamente.');
  } finally { clearTimeout(timer); }
  if (!upstream.ok) {
    if (upstream.status === 401) return error(502, 'O GitHub recusou a credencial da consulta (401). Confira o segredo GITHUB_DATA_TOKEN.');
    if (upstream.status === 403) return error(502, 'O GitHub bloqueou a consulta (403). Confira a permissão Contents: Read-only e o limite de consultas.');
    if (upstream.status === 404) return error(404, 'O GitHub não disponibilizou este arquivo (404). Confira o acesso do token ao repositório privado.');
    return error(502, 'A base de resultados está indisponível (GitHub HTTP ' + upstream.status + ').');
  }
  let data;
  try { data = await upstream.json(); } catch { return error(502, 'A base retornou um arquivo inválido.'); }
  if (path === 'index.json' ? !Array.isArray(data) : (!data || Array.isArray(data) || typeof data !== 'object')) return error(502, 'Formato de dados inválido.');
  const response = Response.json(data, {headers:{
    'Cache-Control':'public, max-age=300',
    'X-Content-Type-Options':'nosniff'
  }});
  if (edgeCache) context.waitUntil(edgeCache.put(cacheKey, response.clone()));
  return request.method === 'HEAD' ? new Response(null, response) : response;
}
