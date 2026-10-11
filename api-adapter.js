/*
 * Time da Virada — adapter browser/Cloudflare Pages
 * Objetivo: manter app.js praticamente intacto enquanto substituímos
 * google.script.run por fetch() direto de bases estáticas/oficiais.
 */
(() => {
  'use strict';

  const FALLBACK_CONFIG = {
    app: {
      nome: 'Time da Virada',
      versao: 'cloudflare-migration-preview',
      slogan: 'Nós somos o time da virada, nós somos o time do amor',
      credito: 'Aplicativo desenvolvido por Tiago Rocha — Engenheiro e mestre pela UFMG',
      fonteRodape: 'Fontes: TSE, IBGE e demais bases oficiais indicadas em cada card'
    },
    secoes: {},
    tseBaseUrl: '/api/dados'
  };

  const cache = new Map();
  let contentPromise = null;
  let configPromise = null;
  let municipiosPromise = null;
  let tseIndexPromise = null;

  async function fetchJson(url, options = {}) {
    if (!options.noCache && cache.has(url)) return cache.get(url);
    const p = fetch(url, { headers: { Accept: 'application/json' }, cache: 'default' })
      .then(async r => {
        if (!r.ok) {
          if (String(url).startsWith('/api/dados/')) {
            const problem = await r.json().catch(() => null);
            if (problem && typeof problem.error === 'string') throw new Error(problem.error);
          }
          throw new Error(`HTTP ${r.status} em ${url}`);
        }
        return r.json();
      });
    if (!options.noCache) cache.set(url, p);
    try { return await p; }
    catch (e) { if (!options.noCache) cache.delete(url); throw e; }
  }

  async function loadConfig() {
    if (!configPromise) {
      configPromise = fetchJson('./data/config.json').catch(() => FALLBACK_CONFIG);
    }
    return configPromise;
  }

  async function loadContent() {
    if (!contentPromise) {
      contentPromise = Promise.all([
        fetchJson('./data/planos.json').catch(() => []),
        fetchJson('./data/retrospecto.json').catch(() => []),
        fetchJson('./data/plano-de-jogo.json').catch(() => []),
        fetchJson('./data/fontes.json').catch(() => []),
        fetchJson('./data/regras-cards.json').catch(() => [])
      ]).then(([planos, retrospecto, planoDeJogo, fontes, regrasCards]) => ({
        planos, retrospecto, planoDeJogo, fontes, regrasCards
      }));
    }
    return contentPromise;
  }

  function ibgeUf(m) {
    try { return m.microrregiao.mesorregiao.UF.sigla; } catch (e) {}
    try { return m['regiao-imediata']['regiao-intermediaria'].UF.sigla; } catch (e) {}
    return '';
  }

  async function getMunicipiosCompact() {
    if (!municipiosPromise) {
      const url = 'https://servicodados.ibge.gov.br/api/v1/localidades/municipios?orderBy=nome';
      municipiosPromise = fetchJson(url).then(raw => raw.map(m => [String(m.id), String(m.nome), String(ibgeUf(m))]));
    }
    return municipiosPromise;
  }

  function normalizeName(v) {
    return String(v || '').trim().toUpperCase().normalize('NFD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[^A-Z0-9]+/g, ' ')
      .replace(/\s+/g, ' ').trim();
  }

  function round2(v) { return Math.round(Number(v || 0) * 100) / 100; }
  function pad5(v) { return String(v == null ? '' : v).padStart(5, '0'); }

  async function getTseIndex() {
    if (!tseIndexPromise) {
      tseIndexPromise = loadConfig().then(cfg => fetchJson(`${String(FALLBACK_CONFIG.tseBaseUrl).replace(/\/$/, '')}/index.json`));
    }
    return tseIndexPromise;
  }

  async function resolveTseMunicipio(params) {
    const uf = String(params.uf || '').toUpperCase();
    const nome = normalizeName(params.municipio || '');
    const index = await getTseIndex();
    const x = (index || []).find(i => String(i.uf || '').toUpperCase() === uf && normalizeName(i.municipio) === nome);
    if (!x) return null;
    const code = pad5(x.tseCode);
    return { uf, tseCode: code, nome: x.municipio || params.municipio || '', shard: String(x.shard || code.slice(0,2)) };
  }

  async function getTsePayload(params) {
    const cfg = await loadConfig();
    const base = String(FALLBACK_CONFIG.tseBaseUrl).replace(/\/$/, '');
    const ref = await resolveTseMunicipio(params);
    if (!ref) return null;
    const uf = ref.uf.toLowerCase();
    const prefix = ref.shard || ref.tseCode.slice(0,2);
    const urls = [`${base}/locais/${uf}/${prefix}.json`, `${base}/${uf}/${prefix}.json`];
    for (const url of urls) {
      try {
        const shard = await fetchJson(url);
        if (shard && shard[ref.tseCode]) return { ref, payload: shard[ref.tseCode], url };
      } catch (e) {}
    }
    return null;
  }

  async function getLula2022(ref, lula2026) {
    if (!ref || !ref.tseCode || !ref.uf) return null;
    const uf = ref.uf.toLowerCase();
    const code = pad5(ref.tseCode);
    const url = `https://resultados.tse.jus.br/oficial/ele2022/544/dados/${uf}/${uf}${code}-c0001-e000544-v.json`;
    try {
      const data = await fetchJson(url);
      const abrs = Array.isArray(data && data.abr) ? data.abr : [];
      let found = null;
      for (const a of abrs) {
        for (const c of (Array.isArray(a.cand) ? a.cand : [])) {
          const num = Number(c.n || c.nr || c.numero || 0);
          const nome = normalizeName(c.nm || c.nmu || c.nome || '');
          if (num === 13 || nome.includes('LULA')) {
            found = { votos: numVal(c.vap != null ? c.vap : c.votos), percentualValidos: numVal(c.pvap != null ? c.pvap : c.percentualValidos) };
            break;
          }
        }
        if (found) break;
      }
      if (!found) return null;
      const atual = lula2026 ? Number(lula2026.votos || 0) : null;
      return {
        lulaVotos: Number(found.votos || 0),
        lulaPercentualValidos: found.percentualValidos,
        votos2026: atual,
        variacaoVotos: atual == null ? null : atual - Number(found.votos || 0),
        variacaoPercentualVotos: found.votos > 0 && atual != null ? round2((atual - found.votos) * 100 / found.votos) : null,
        fonte: 'TSE — 1º turno de 2022',
        fonteUrl: url
      };
    } catch (e) {
      console.warn('Comparação 2022 indisponível no navegador:', e);
      return null;
    }
  }

  function numVal(v) {
    if (v === null || v === undefined || v === '') return null;
    const s = String(v).trim();
    if (!s || s === '-' || s === '...' || s === '..' || s.toUpperCase() === 'X') return null;
    const n = Number(s.replace(/\./g, '').replace(',', '.'));
    return Number.isFinite(n) ? n : null;
  }

  async function resumoMunicipal(info) {
    if (!info || !info.payload) return { status: 'municipio_tse_nao_encontrado', candidatos: [] };
    const { payload, ref } = info;
    const locais = Array.isArray(payload.locais) ? payload.locais : [];
    let eleitorado = Number(payload.eleitores || 0), comparecimento = 0, abstencoes = 0, votosValidos = 0, brancos = 0, nulos = 0;
    const zonasSet = new Set(), secoesSet = new Set(), candMap = new Map();
    for (const l of locais) {
      comparecimento += Number(l.comparecimento || 0);
      abstencoes += Number(l.naoVotaram || 0);
      votosValidos += Number(l.votosValidos || 0);
      brancos += Number(l.brancos || 0);
      nulos += Number(l.nulos || 0);
      if (l.zona != null && String(l.zona).trim()) zonasSet.add(String(Number(l.zona)));
      for (const s of (l.secoes || [])) secoesSet.add(String(s));
      for (const c of (l.candidatos || [])) {
        const numero = Number(c.numero), key = String(numero);
        if (!candMap.has(key)) candMap.set(key, { numero, nome:c.nome||'', nomeCompleto:c.nome||'', partido:'', votos:0, percentualValidos:0, percentualNominais:null, situacao:'', eleito:false });
        candMap.get(key).votos += Number(c.votos || 0);
      }
    }
    if (!eleitorado) eleitorado = locais.reduce((a,l) => a + Number(l.eleitores || 0), 0);
    const candidatos = [...candMap.values()].map(c => ({ ...c, percentualValidos: votosValidos ? round2(c.votos * 100 / votosValidos) : 0 }))
      .sort((a,b) => b.votos - a.votos);
    const lula2026 = candidatos.find(c => Number(c.numero) === 13) || null;
    const comparacao2022 = await getLula2022(ref, lula2026);
    return {
      status:'ok', eleicao:6257, turno:Number(payload.turno || 1), fase:'final', finalizado:true,
      dataGeracao:'', horaGeracao:'', eleitorado, comparecimento,
      comparecimentoPct: eleitorado ? round2(comparecimento*100/eleitorado) : 0,
      abstencoes, abstencaoPct: eleitorado ? round2(abstencoes*100/eleitorado) : 0,
      votosTotais:comparecimento, votosValidos, brancos, nulos,
      secoesTotal:secoesSet.size, secoesTotalizadas:secoesSet.size, secoesTotalizadasPct:100,
      candidatos, zonas:[...zonasSet].sort((a,b)=>Number(a)-Number(b)), tseCode:pad5(payload.tseCode || ref.tseCode),
      comparacao2022, fonte:'TSE — Eleitorado por local de votação 2026 + Votação por seção 2026', fonteUrl:info.url || ''
    };
  }

  // ---------- IBGE ----------
  const IBGE_AGG = 'https://servicodados.ibge.gov.br/api/v3/agregados';
  const IBGE_PESQ = 'https://servicodados.ibge.gov.br/api/v1/pesquisas';

  async function ibgeGetVariables(table, period, variables, locations, classification='') {
    let url = `${IBGE_AGG}/${table}/periodos/${period}/variaveis/${encodeURIComponent(variables)}?localidades=${encodeURIComponent(locations)}`;
    if (classification) url += `&classificacao=${encodeURIComponent(classification)}`;
    return fetchJson(url);
  }
  async function ibgeMetadata(table){ return fetchJson(`${IBGE_AGG}/${table}/metadados`); }
  function findVariableBlock(data,id){ return Array.isArray(data) ? data.find(x=>String(x.id)===String(id)) || null : null; }
  function resultCategoryNames(result){
    const labels=[]; for(const c of (result.classificacoes||[])){ const cat=c.categoria||{}; for(const k of Object.keys(cat)){ if(cat[k]) labels.push(String(cat[k])); } } return labels;
  }
  function ibgeFlattenSeries(block){
    const rows=[]; for(const r of (block&&block.resultados||[])){ const labels=resultCategoryNames(r); for(const s of (r.series||[])){ const serie=s.serie||{}; for(const periodo of Object.keys(serie)){ const valor=numVal(serie[periodo]); if(valor==null) continue; rows.push({localidadeId:s.localidade&&s.localidade.id?String(s.localidade.id):'', localidadeNome:s.localidade&&s.localidade.nome?s.localidade.nome:'', periodo, valor, labels}); } } } return rows;
  }
  function ibgeFirstValue(data,id){ const b=findVariableBlock(data,id); const rows=b?ibgeFlattenSeries(b):[]; return rows.length?rows[0].valor:null; }
  function normIbge(v){ return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/\s+/g,' ').trim(); }
  function findClassification(meta,wanted){ const t=normIbge(wanted); return (meta&&meta.classificacoes||[]).find(x=>{const n=normIbge(x.nome);return n===t||n.includes(t);}) || null; }
  function categoryIdByName(cl,wanted){ const t=normIbge(wanted); const x=(cl&&cl.categorias||[]).find(c=>normIbge(c.nome)===t); return x?String(x.id):null; }
  function categoryValueMap(data,id){ const out={}; const b=findVariableBlock(data,id); if(!b)return out; for(const r of ibgeFlattenSeries(b)) out[r.labels.join(' | ')]=r.valor; return out; }
  function categoryMatchValue(obj,regex){ for(const k of Object.keys(obj)){ if(k.split('|').map(x=>x.trim()).some(x=>regex.test(x))) return obj[k]; } return null; }
  function valueById(vals,id){ return vals.find(x=>x.id===id)||null; }
  function pushSimple(dest,data,varId,id,nome,unidade,fonteKey,periodo){ const valor=ibgeFirstValue(data,varId); if(valor==null)return; dest.push({id,nome,valor,unidade,qualidade:'ALTA',percentilUF:null,percentilBrasil:null,percentilPorte:null,tendencia:null,fonteKey,periodo:String(periodo)}); }

  async function urbanizacao(code){
    const meta=await ibgeMetadata('9923'); const cl=findClassification(meta,'situacao do domicilio'); if(!cl) throw new Error('Classificação de domicílio não encontrada');
    const data=await ibgeGetVariables('9923','2022','93',`N6[${code}]`,`${cl.id}[all]`); const vals=categoryValueMap(data,'93'); const total=categoryMatchValue(vals,/^total$/i), urbana=categoryMatchValue(vals,/^urbana$/i); if(!(total>0)||urbana==null)return null; return round2(urbana/total*100);
  }
  async function faixasEtarias(code){
    const meta=await ibgeMetadata('9514'), idade=findClassification(meta,'idade'), sexo=findClassification(meta,'sexo'), forma=findClassification(meta,'forma de declaracao da idade');
    if(!idade||!sexo||!forma) throw new Error('Metadados etários incompletos');
    const ids=[]; for(const c of (idade.categorias||[])){ const n=normIbge(c.nome), m=n.match(/^(\d+)\s+anos?$/); if(m){const age=Number(m[1]); if((age>=15&&age<=29)||age>=60) ids.push(String(c.id));} else if(/^100\s+anos?\s+ou\s+mais/.test(n)) ids.push(String(c.id)); }
    const st=categoryIdByName(sexo,'total'), ft=categoryIdByName(forma,'total'); if(!ids.length||st==null||ft==null) throw new Error('Categorias etárias necessárias não encontradas');
    const cp=`${sexo.id}[${st}]|${forma.id}[${ft}]|${idade.id}[${ids.join(',')}]`;
    const data=await ibgeGetVariables('9514','2022','93',`N6[${code}]`,cp), b=findVariableBlock(data,'93'); if(!b)return null;
    let jovens=0,idosos=0,hj=false,hi=false; for(const row of ibgeFlattenSeries(b)){ const label=normIbge(row.labels.join(' ')), m=label.match(/\b(\d+)\s+anos?\b/); if(m){const a=Number(m[1]); if(a>=15&&a<=29){jovens+=row.valor;hj=true;} if(a>=60){idosos+=row.valor;hi=true;}} else if(/100\s+anos?\s+ou\s+mais/.test(label)){idosos+=row.valor;hi=true;} }
    return {jovens:hj?jovens:null, idosos:hi?idosos:null};
  }
  async function pibPerCapita(code){
    const code6=String(code).replace(/\D/g,'').slice(0,6); const data=await fetchJson(`${IBGE_PESQ}/38/indicadores/47001/resultados/${code6}`); if(!Array.isArray(data)||!data.length)return null;
    const list=Array.isArray(data[0].res)?data[0].res:[]; if(!list.length)return null; const match=list.find(x=>String(x.localidade)===code6)||list[0], res=match.res||{}; const years=Object.keys(res).sort();
    for(let i=years.length-1;i>=0;i--){const raw=res[years[i]], v=raw==null||raw===''?null:Number(String(raw).trim().replace(',','.')); if(v!=null&&Number.isFinite(v)) return {valor:v,periodo:years[i]};} return null;
  }
  async function agroPct(code){ const data=await ibgeGetVariables('5938','2021','37|513',`N6[${code}]`,''); const pib=ibgeFirstValue(data,'37'), agro=ibgeFirstValue(data,'513'); return pib>0&&agro!=null?round2(agro/pib*100):null; }

  async function getIndicadores(params){
    const code=String(params.ibgeCode||''), valores=[], erros=[];
    try{ const bas=await ibgeGetVariables('4714','2022','93|6318|614',`N6[${code}]`,''); pushSimple(valores,bas,'93','populacao_2022','População residente','pessoas','IBGE_CENSO_2022','2022'); pushSimple(valores,bas,'6318','area_km2','Área territorial','km²','IBGE_CENSO_2022','2022'); pushSimple(valores,bas,'614','densidade_demo','Densidade demográfica','hab./km²','IBGE_CENSO_2022','2022'); }catch(e){erros.push('Censo 2022 básico: '+e.message);}
    const pop=valueById(valores,'populacao_2022');
    try{ const u=await urbanizacao(code); if(u!=null){ valores.push({id:'urbanizacao_pct',nome:'População urbana',valor:u,unidade:'%',qualidade:'ALTA',fonteKey:'IBGE_CENSO_2022',periodo:'2022'}); valores.push({id:'pop_rural_pct',nome:'População rural',valor:round2(100-u),unidade:'%',qualidade:'ALTA',fonteKey:'IBGE_CENSO_2022',periodo:'2022'}); } }catch(e){erros.push('Urbanização: '+e.message);}
    if(pop&&pop.valor>0){ try{ const f=await faixasEtarias(code); if(f&&f.jovens!=null) valores.push({id:'pop_15_29_pct',nome:'População de 15 a 29 anos',valor:round2(f.jovens/pop.valor*100),unidade:'%',qualidade:'ALTA',fonteKey:'IBGE_CENSO_2022',periodo:'2022'}); if(f&&f.idosos!=null) valores.push({id:'pop_60mais_pct',nome:'População com 60 anos ou mais',valor:round2(f.idosos/pop.valor*100),unidade:'%',qualidade:'ALTA',fonteKey:'IBGE_CENSO_2022',periodo:'2022'}); }catch(e){erros.push('Estrutura etária: '+e.message);} }
    try{ const p=await pibPerCapita(code); if(p) valores.push({id:'pib_per_capita',nome:'PIB per capita',valor:p.valor,unidade:'R$',qualidade:'ALTA',fonteKey:'IBGE_PIB_MUNICIPIOS',periodo:p.periodo}); }catch(e){erros.push('PIB per capita: '+e.message);}
    try{ const a=await agroPct(code); if(a!=null) valores.push({id:'vab_agro_pct_pib',nome:'VAB da agropecuária / PIB municipal',valor:a,unidade:'%',qualidade:'ALTA',fonteKey:'IBGE_PIB_MUNICIPIOS',periodo:'2021'}); }catch(e){erros.push('VAB agro: '+e.message);}
    return {status:valores.length?'parcial_ok':'indisponivel',ibgeCode:code,valores,erros,entornoSetorCensitario:null};
  }

  function splitSemi(v){ return String(v||'').split(';').map(x=>x.trim()).filter(Boolean); }
  function indicadorConfiavel(v){ if(!v||v.valor===null||v.valor===undefined||v.valor==='') return false; const q=String(v.qualidade||'ALTA').toUpperCase(); return q!=='BAIXA'&&q!=='INSUFICIENTE'; }
  function buildCards(indicadores,regras){
    const vals=(indicadores&&indicadores.valores)||[], byId={}; vals.forEach(v=>{if(v&&v.id)byId[String(v.id)]=v;}); const cards=[];
    for(const r of (regras||[])){
      const ativo=String(r.ativo||'SIM').toUpperCase(); if(ativo!=='SIM') continue; if(String(r.tema||'')==='Urbanização e território')continue;
      const ids=splitSemi(r.indicadores_chave||r.indicadoresChave), disponiveis0=ids.map(id=>byId[id]).filter(indicadorConfiavel); let disponiveis=disponiveis0;
      if(String(r.tema||'')==='Habitação e infraestrutura') disponiveis=disponiveis.filter(v=>String(v.id)!=='urbanizacao_pct');
      if(!disponiveis.length)continue;
      cards.push({ruleId:r.rule_id||r.ruleId||'',tema:r.tema||'',titulo:r.titulo_card||r.tituloCard||r.tema||'',leitura:r.leitura_base||r.leituraBase||'',indicadores:disponiveis,subtemasPlanos:splitSemi(r.subtemas_planos||r.subtemasPlanos),areaRetrospecto:r.area_retrospecto||r.areaRetrospecto||'',sourceKeys:splitSemi(r.source_keys||r.sourceKeys)});
    }
    return cards;
  }

  async function getGeo(code){ return fetchJson(`https://servicodados.ibge.gov.br/api/v3/malhas/municipios/${encodeURIComponent(String(code))}?formato=application/vnd.geo+json&qualidade=minima`); }

  // ---------- Compatibilidade google.script.run ----------
  const methods = {
    async getBootstrap(){
      const [cfg, municipios] = await Promise.all([loadConfig(), getMunicipiosCompact()]);
      return { app:cfg.app||FALLBACK_CONFIG.app, visual:{fundo:'#FFFFFF',verde:'#0B6B3A',amarelo:'#F2B705',vermelho:'#D62828'}, secoes:cfg.secoes||{}, municipios, craques:Number(localStorage.getItem('tdv_craques_preview')||0), planilhaConfigurada:true };
    },
    async registrarAcesso(){
      // Contador real será migrado depois para uma função mínima do Cloudflare.
      let n=Number(localStorage.getItem('tdv_craques_preview')||0); if(!n){n=1; localStorage.setItem('tdv_craques_preview','1');} return {total:n,registrado:false};
    },
    async getDashboardMunicipio(params){
      const [info, content] = await Promise.all([getTsePayload(params), loadContent()]);
      const eleitoral = await resumoMunicipal(info);
      return {contexto:{ibgeCode:String(params.ibgeCode||''),municipio:String(params.municipio||''),uf:String(params.uf||'')},eleitoral,locais:info&&info.payload&&Array.isArray(info.payload.locais)?info.payload.locais:[],planos:content.planos||[],retrospecto:content.retrospecto||[],planoDeJogo:content.planoDeJogo||[],fontes:content.fontes||[],meta:{atualizadoEm:new Date().toISOString(),planilhaConfigurada:true}};
    },
    async getIndicadoresMunicipio(params){ const [indicadores,content]=await Promise.all([getIndicadores(params),loadContent()]); return {indicadores,cards:buildCards(indicadores,content.regrasCards)}; },
    async getMunicipioGeoJson(code){ return getGeo(code); }
  };

  function runner(success, failure){
    const obj={
      withSuccessHandler(fn){ return runner(fn,failure); },
      withFailureHandler(fn){ return runner(success,fn); }
    };
    for(const [name,fn] of Object.entries(methods)){
      obj[name]=(...args)=>{ Promise.resolve().then(()=>fn(...args)).then(v=>success&&success(v)).catch(e=>{console.error(e); if(failure) failure(e); else throw e;}); };
    }
    return obj;
  }

  window.google = window.google || {};
  window.google.script = window.google.script || {};
  Object.defineProperty(window.google.script,'run',{ configurable:true, get(){ return runner(null,null); } });
})();
