const state = {
  bootstrap:null,
  municipios:[],
  selected:null,
  dashboard:null,
  ibgePayload:null,
  geo:null,
  geoError:false,
  showAllPlans:false,
  placeQuery:'',
  placeLimit:40,
  querySeed:1,
  planOrder:[],
  retroOrder:[],
  retroLimit:16,
  map:null,
  mapBoundary:null,
  mapMarkers:{}
};
const $ = id => document.getElementById(id);

document.addEventListener('DOMContentLoaded', init);

function init(){
  $('municipioInput').addEventListener('input', handleSearch);
  $('fontesBtn').addEventListener('click', () => $('fontesContent').classList.toggle('hidden'));
  $('outrosTemasBtn').addEventListener('click', togglePlanos);
  $('retroMoreBtn').addEventListener('click', expandRetrospecto);
  $('downloadPdfBtn').addEventListener('click', () => exportDashboardPdf(false));
  $('sharePdfBtn').addEventListener('click', () => exportDashboardPdf(true));
  document.addEventListener('click', ev => {
    if(!ev.target.closest('.autocomplete')) $('suggestions').classList.remove('show');
  });

  google.script.run
    .withSuccessHandler(data => {
      state.bootstrap = data;
      state.municipios = (data.municipios || []).map(x => ({id:String(x[0]), nome:String(x[1]), uf:String(x[2])}));
      $('slogan').textContent = data.app.slogan || '';
      $('creditoApp').textContent = data.app.credito || '';
      $('fonteRodape').textContent = data.app.fonteRodape || '';
      setCraques(data.craques || 0);
      applySectionLabels(data.secoes || {});
      registrarSessao();
      setLoading(false);
    })
    .withFailureHandler(showError)
    .getBootstrap();
}

function registrarSessao(){
  const key = 'tdv_session_v1';
  const now = Date.now();
  let obj = null;
  try { obj = JSON.parse(localStorage.getItem(key) || 'null'); } catch(e){}
  if(!obj || !obj.id || !obj.created || now - obj.created > 21600000){
    obj = { id: 's_' + now.toString(36) + '_' + Math.random().toString(36).slice(2,12), created: now };
    localStorage.setItem(key, JSON.stringify(obj));
  }
  google.script.run.withSuccessHandler(r => {
    if(r && typeof r.total !== 'undefined') setCraques(r.total);
  }).registrarAcesso(obj.id, {});
}

function setCraques(n){
  const v = Number(n||0).toLocaleString('pt-BR');
  $('craquesCount').textContent = v;
  $('craquesBig').textContent = v;
}

function applySectionLabels(s){
  const map = {
    secJogo:'jogoAqui', secPlacar:'placar', secLeitura:'leitura', secOnde:'onde',
    secMapa:'mapa', secPrancheta:'prancheta', secJogoPolitico:'jogo',
    secRetrospecto:'retrospecto', secPlano:'plano', secLimites:'limites'
  };
  Object.keys(map).forEach(id => { if($(id) && s[map[id]]) $(id).textContent = s[map[id]]; });
}

function handleSearch(){
  const q = norm($('municipioInput').value);
  state.selected = null;
  if(q.length < 2){
    $('suggestions').classList.remove('show');
    $('suggestions').innerHTML='';
    return;
  }
  const matches = state.municipios.map(m => {
    const n=norm(m.nome), f=norm(m.nome+' '+m.uf); let score=999;
    if(n===q) score=0; else if(n.startsWith(q)) score=1; else if(f.startsWith(q)) score=2;
    else if(n.includes(q)) score=3; else if(f.includes(q)) score=4;
    return {m,score};
  }).filter(x=>x.score<999)
    .sort((a,b)=>a.score-b.score||a.m.nome.localeCompare(b.m.nome,'pt-BR'))
    .slice(0,15).map(x=>x.m);
  renderSuggestions(matches);
}

function renderSuggestions(items){
  const box=$('suggestions');
  if(!items.length){
    box.innerHTML='<div class="suggestion">Nenhum município encontrado</div>';
    box.classList.add('show');
    return;
  }
  box.innerHTML=items.map((m,i)=>`<div class="suggestion" data-i="${i}"><strong>${esc(m.nome)}</strong><span>${esc(m.uf)}</span></div>`).join('');
  [...box.querySelectorAll('[data-i]')].forEach(el=>el.addEventListener('click',()=>selectMunicipio(items[Number(el.dataset.i)])));
  box.classList.add('show');
}

function selectMunicipio(m){
  state.selected=m;
  state.dashboard=null;
  state.ibgePayload=null;
  state.geo=null;
  state.geoError=false;
  state.showAllPlans=false;
  state.placeQuery='';
  state.placeLimit=40;
  state.querySeed=hashSeed(`${m.id}|${Date.now()}|${Math.random()}`);
  state.planOrder=[];
  state.retroOrder=[];
  state.retroLimit=16;
  destroyMap();

  $('municipioInput').value=`${m.nome} — ${m.uf}`;
  $('suggestions').classList.remove('show');
  $('municipioNome').textContent=`${m.nome} — ${m.uf}`;
  $('localTag').textContent=m.uf;
  $('content').classList.remove('hidden');
  $('miniMap').innerHTML='<div class="map-placeholder">Carregando mapa...</div>';
  $('indicadoresResumo').innerHTML='<div class="empty-state">Consultando indicadores do IBGE em segundo plano...</div>';
  $('cardsContent').innerHTML='<div class="empty-state">Consultando dados municipais em segundo plano...</div>';

  // O loading principal espera apenas o resultado eleitoral e o conteúdo-base.
  setLoading(true,'Carregando resultado eleitoral...');

  google.script.run
    .withSuccessHandler(data=>{
      state.dashboard=data||{};
      if(state.ibgePayload){
        state.dashboard.indicadores=state.ibgePayload.indicadores||{valores:[]};
        state.dashboard.cards=state.ibgePayload.cards||[];
      }

      let uiError=null;
      try{
        renderDashboard(state.dashboard);
      }catch(e){
        uiError=e;
        console.error('Erro ao montar a tela:',e);
      }finally{
        // O mapa e o IBGE nunca podem manter a tela presa no loading.
        setLoading(false);
      }

      renderMapSafe();
      if(uiError){
        alert('Os dados foram carregados, mas houve um erro ao montar parte da tela: '+(uiError.message||String(uiError)));
      }
    })
    .withFailureHandler(showError)
    .getDashboardMunicipio({ibgeCode:m.id,municipio:m.nome,uf:m.uf});

  // Indicadores do IBGE são independentes do placar.
  google.script.run
    .withSuccessHandler(payload=>{
      state.ibgePayload=payload||{indicadores:{valores:[]},cards:[]};
      if(state.dashboard){
        state.dashboard.indicadores=state.ibgePayload.indicadores||{valores:[]};
        state.dashboard.cards=state.ibgePayload.cards||[];
      }
      try{
        renderIndicadores((state.ibgePayload.indicadores&&state.ibgePayload.indicadores.valores)||[]);
        renderCards(state.ibgePayload.cards||[]);
      }catch(e){
        console.error('Erro ao montar indicadores do IBGE:',e);
        renderIbgeUnavailable();
      }
    })
    .withFailureHandler(err=>{
      console.error('Erro ao carregar indicadores do IBGE:',err);
      renderIbgeUnavailable();
    })
    .getIndicadoresMunicipio({ibgeCode:m.id,municipio:m.nome,uf:m.uf});

  // A malha é outra chamada independente.
  google.script.run
    .withSuccessHandler(geo=>{
      state.geo=geo;
      state.geoError=!geo;
      renderMapSafe();
    })
    .withFailureHandler(err=>{
      console.error('Erro ao carregar malha do IBGE:',err);
      state.geo=null;
      state.geoError=true;
      renderMapSafe();
    })
    .getMunicipioGeoJson(m.id);
}

function renderDashboard(data){
  const e=data.eleitoral||{};
  $('municipioResumo').textContent=e.status==='ok'
    ? 'Resultado oficial do 1º turno carregado do TSE.'
    : 'Município selecionado. Algumas camadas ainda podem estar em integração.';

  renderPlacar(e);
  renderLocais(data.locais||[]);
  prepareRetrospecto(data.retrospecto||[]);
  renderRetrospecto();
  preparePlanos(data.planos||[]);
  renderPlanos();
  renderPlanoDeJogo(data.planoDeJogo||[]);
  renderFontes(data.fontes||[]);

  // Se o IBGE já respondeu antes do painel-base, aproveita os dados agora.
  if(state.ibgePayload){
    renderIndicadores((state.ibgePayload.indicadores&&state.ibgePayload.indicadores.valores)||[]);
    renderCards(state.ibgePayload.cards||[]);
  }
}

function renderIbgeUnavailable(){
  const a=$('indicadoresResumo');
  const b=$('cardsContent');
  if(a) a.innerHTML='<div class="empty-state">Indicadores do IBGE indisponíveis nesta consulta. O resultado eleitoral continua disponível normalmente.</div>';
  if(b) b.innerHTML='<div class="empty-state">Dados municipais complementares indisponíveis nesta consulta.</div>';
}

function renderIndicadores(items){
  const root=$('indicadoresResumo');
  const wanted=['populacao_2022','urbanizacao_pct','pib_per_capita','vab_agro_pct_pib','pop_60mais_pct','pop_15_29_pct'];
  const list=wanted.map(id=>items.find(x=>x.id===id)).filter(Boolean);
  root.innerHTML=list.length?list.map(i=>`<div class="indicator-chip">
    <small>${esc(i.nome||i.id)}</small>
    <strong>${fmtIndicator(i)}</strong>
    <em>${esc(i.periodo||'')} · ${esc(sourceShort(i.fonteKey))}</em>
  </div>`).join(''):'<div class="empty-state">Indicadores municipais ainda indisponíveis.</div>';
}

// Prancheta sem rótulos de Relevante/Destaque e sem filtro por percentil.
function renderCards(items){
  const root=$('cardsContent');
  if(!items.length){
    root.innerHTML='<div class="empty-state">Ainda não há outros indicadores temáticos confiáveis disponíveis para este município.</div>';
    return;
  }
  root.innerHTML=`<div class="cards-grid">${items.map(i=>`
    <article class="soft-card analytic-card">
      <div class="proposal-head"><strong>${esc(i.titulo||i.tema)}</strong></div>
      <div class="analytic-values">${(i.indicadores||[]).map(v=>`<div><small>${esc(v.nome||v.id)}</small><b>${fmtIndicator(v)}</b></div>`).join('')}</div>
    </article>`).join('')}</div>`;
}

function shortCandidateName(nome){
  const n=String(nome||'').trim();
  const nn=norm(n);
  if(nn.includes('lula')) return 'Lula';
  if(nn.includes('flavio')&&nn.includes('bolsonaro')) return 'Flávio Bolsonaro';
  if(nn.includes('caiado')) return 'Ronaldo Caiado';
  if(nn.includes('zema')) return 'Romeu Zema';
  if(nn.includes('cury')) return 'Augusto Cury';
  if(nn.includes('renan')) return 'Renan Santos';
  const p=n.split(/\s+/).filter(Boolean);
  return p.length>3?p.slice(0,3).join(' '):n;
}

function getFinalists(candidatos){
  const list=(candidatos||[]).slice();
  const lula=list.find(c=>Number(c.numero)===13 || norm(c.nome).includes('lula')) || null;
  const flavio=list.find(c=>Number(c.numero)===22 || (norm(c.nome).includes('flavio')&&norm(c.nome).includes('bolsonaro'))) || null;
  const outros=list.filter(c=>c!==lula && c!==flavio);
  return {lula,flavio,outros};
}

function viraMessage(lulaVotos,flavioVotos,totalFora){
  const lv=Number(lulaVotos||0), fv=Number(flavioVotos||0);
  if(lv < fv){
    return `<div class="turn-status behind"><span>Diferença para Flávio</span><strong>${fmtInt(fv-lv)} votos</strong></div>`;
  }
  if(lv > fv){
    return `<div class="turn-status ahead"><strong>Lula ganhou aqui, mas o time pode jogar melhor.</strong><span>${fmtInt(totalFora)} ficaram fora dos dois finalistas no 1º turno.</span></div>`;
  }
  return `<div class="turn-status tied"><strong>Jogo empatado aqui.</strong><span>${fmtInt(totalFora)} ficaram fora dos dois finalistas no 1º turno.</span></div>`;
}

function renderPlacar(e){
  const root=$('placarContent');
  if(e.status!=='ok'){
    root.innerHTML=`<div class="empty-state">${esc(e.mensagem||'Resultado do TSE indisponível nesta consulta.')}</div>`;
    return;
  }

  const candidatos=(e.candidatos||[]).slice().sort((a,b)=>Number(b.votos||0)-Number(a.votos||0));
  const f=getFinalists(candidatos);
  const lula=f.lula, flavio=f.flavio, outros=f.outros;
  const votosOutros=outros.reduce((a,c)=>a+Number(c.votos||0),0);
  const pctOutros=Number(e.votosValidos||0)>0 ? votosOutros*100/Number(e.votosValidos) : 0;
  const foraJogo=Number(e.brancos||0)+Number(e.nulos||0);
  const foraJogoPct=Number(e.comparecimento||0)>0 ? foraJogo*100/Number(e.comparecimento) : 0;
  const totalForaFinalistas=votosOutros+Number(e.abstencoes||0)+foraJogo;

  const placarCand=c=>c?`<div class="field-player">
    <span class="shirt-number">${esc(String(c.numero||''))}</span>
    <div><strong>${esc(shortCandidateName(c.nome))}</strong><small>${fmtInt(c.votos)} votos</small></div>
    <b>${fmtPct(c.percentualValidos)}</b>
  </div>`:'';

  const comp=e.comparacao2022||null;
  let retro='';
  if(comp && comp.lulaVotos!=null && lula){
    const v22=Number(comp.lulaVotos||0), v26=Number(lula.votos||0);
    const p22=Number(comp.lulaPercentualValidos), p26=Number(lula.percentualValidos);
    const delta=v26-v22;
    const deltaPp=(isFinite(p22)&&isFinite(p26)) ? p26-p22 : null;
    const abs=Math.abs(delta);
    retro=`<section class="game-block retrospect-block">
      <div class="game-label">📊 RETROSPECTO — LULA 2022 × 2026</div>
      <div class="retro-stats">
        <div><small>2022</small><strong>${fmtInt(v22)}</strong><span>${isFinite(p22)?fmtPct(p22):''}</span></div>
        <div><small>2026</small><strong>${fmtInt(v26)}</strong><span>${fmtPct(p26)}</span></div>
        <div><small>Variação de votos</small><strong>${delta>0?'+':''}${fmtInt(delta)}</strong></div>
        <div><small>Variação</small><strong>${deltaPp==null?'—':signedPp(deltaPp)}</strong></div>
      </div>
      ${delta<0?`<div class="stadium-callout">👥 <strong>Torcedores que ficaram fora do estádio</strong><span>${fmtInt(abs)} votos a menos para Lula em relação a 2022.</span></div>`:''}
      ${delta>0?`<div class="stadium-callout positive">🎉 <strong>Arquibancada cresceu</strong><span>+${fmtInt(abs)} votos para Lula em relação a 2022.</span></div>`:''}
    </section>`;
  }

  root.innerHTML=`
    <div class="score-meta">
      <span><small>Eleitorado</small><b>${fmtInt(e.eleitorado)}</b></span>
      <span><small>Comparecimento</small><b>${fmtInt(e.comparecimento)}</b></span>
      <span><small>Votos válidos</small><b>${fmtInt(e.votosValidos)}</b></span>
    </div>
    <section class="game-block on-field"><div class="game-label">🥅 EM CAMPO</div><div class="field-grid">${placarCand(lula)}${placarCand(flavio)}</div></section>
    <section class="game-block neutral-block">
      <div class="game-row"><div><div class="game-label">👥 TORCEDORES NEUTROS</div><small>Votos dados aos demais candidatos no 1º turno</small></div><div class="game-number"><strong>${fmtInt(votosOutros)}</strong><span>${fmtPct(pctOutros)} dos válidos</span></div></div>
      ${outros.length?`<div class="other-candidates">${outros.map(c=>`<span>${esc(shortCandidateName(c.nome))} <b>${fmtInt(c.votos)}</b></span>`).join('')}</div>`:''}
    </section>
    <div class="game-two-col">
      <section class="game-block bench-block"><div class="game-label">🪑 NÃO ENTRARAM EM CAMPO</div><strong class="big-number">${fmtInt(e.abstencoes)}</strong><small>Eleitores que não compareceram · ${fmtPct(e.abstencaoPct)} do eleitorado</small></section>
      <section class="game-block out-block"><div class="game-label">🚩 FORA DE JOGO</div><strong class="big-number">${fmtInt(foraJogo)}</strong><small>Brancos + nulos · ${fmtInt(e.brancos)} brancos · ${fmtInt(e.nulos)} nulos · ${fmtPct(foraJogoPct)} dos presentes</small></section>
    </div>
    <section class="game-block turn-block"><div class="game-label">🔥 DÁ PRA VIRAR?</div><div class="turn-total"><small>Fora dos dois finalistas no 1º turno</small><strong>${fmtInt(totalForaFinalistas)}</strong></div>${viraMessage(lula&&lula.votos,flavio&&flavio.votos,totalForaFinalistas)}</section>
    ${retro}
    <div class="tse-source">Fonte: TSE · 1º turno de 2026${comp?' · retrospecto individual de Lula com o 1º turno de 2022':''}</div>`;
}

function renderLocais(items){
  const root=$('locaisContent');
  if(!items.length){
    root.innerHTML='<div class="empty-state">Os locais de votação não foram retornados para este município.</div>';
    return;
  }

  const totalEleitores=items.reduce((a,l)=>a+Number(l.eleitores||0),0);
  const totalNao=items.reduce((a,l)=>a+Number(l.naoVotaram||0),0);
  root.innerHTML=`
    <div class="places-summary"><strong>${items.length} locais de votação</strong><span>${fmtInt(totalEleitores)} eleitores</span><span>${fmtInt(totalNao)} não compareceram</span></div>
    <div class="place-search-wrap no-export"><input id="placeSearch" type="search" placeholder="Buscar escola, prédio, bairro/localidade ou endereço..." autocomplete="off"><small id="placeSearchCount"></small></div>
    <div id="placesList" class="places-accordion"></div>
    <button id="placesMoreBtn" class="secondary-button hidden no-export" type="button">Mostrar mais</button>`;

  $('placeSearch').addEventListener('input', ev=>{ state.placeQuery=ev.target.value||''; state.placeLimit=40; renderPlacesFiltered(); });
  $('placesMoreBtn').addEventListener('click',()=>{ state.placeLimit += 40; renderPlacesFiltered(); });
  renderPlacesFiltered();
}

function filteredPlaces(){
  const items=(state.dashboard&&state.dashboard.locais)||[];
  const q=norm(state.placeQuery);
  const sorted=items.slice().sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''),'pt-BR'));
  if(!q) return sorted;
  return sorted.filter(l=>norm([l.nome,l.localidade,l.endereco,l.cep].join(' ')).includes(q));
}

function renderPlacesFiltered(){
  const list=$('placesList');
  if(!list) return;
  const filtered=filteredPlaces();
  const shown=filtered.slice(0,state.placeLimit);
  $('placeSearchCount').textContent=`${filtered.length} ${filtered.length===1?'local encontrado':'locais encontrados'}`;
  list.innerHTML=shown.map(placeAccordionHtml).join('');

  const more=$('placesMoreBtn');
  if(filtered.length>shown.length){ more.classList.remove('hidden'); more.textContent=`Mostrar mais (${filtered.length-shown.length} restantes)`; }
  else more.classList.add('hidden');

  [...list.querySelectorAll('.map-place-btn')].forEach(btn=>{
    btn.addEventListener('click', ev=>{
      ev.preventDefault(); ev.stopPropagation();
      focusPlaceOnMap(btn.dataset.lat,btn.dataset.lon,btn.dataset.name,btn.dataset.code);
    });
  });
}

function placeAccordionHtml(l){
  const cand=(l.candidatos||[]).slice();
  const f=getFinalists(cand);
  const lula=f.lula||{votos:0,percentualValidos:0};
  const flavio=f.flavio||{votos:0,percentualValidos:0};
  const neutros=f.outros.reduce((a,c)=>a+Number(c.votos||0),0);
  const fora=Number(l.brancos||0)+Number(l.nulos||0);
  const totalFora=neutros+Number(l.naoVotaram||0)+fora;
  const code=String(l.codigo||'');

  return `<details class="place-accordion-item" data-place-code="${escAttr(code)}">
    <summary><div class="place-summary-main"><strong>${esc(l.nome||'Local de votação')}</strong><span>${esc(l.localidade||'')}${l.localidade&&l.eleitores?' · ':''}${fmtInt(l.eleitores)} eleitores</span></div><span class="place-open-label">Ver placar</span></summary>
    <div class="place-body">
      ${l.endereco?`<div class="place-address">${esc(l.endereco)}${l.cep?` · CEP ${esc(l.cep)}`:''}</div>`:''}
      <div class="place-finalists"><div><small>Lula</small><strong>${fmtInt(lula.votos)}</strong><span>${fmtPct(lula.percentualValidos)}</span></div><div><small>Flávio</small><strong>${fmtInt(flavio.votos)}</strong><span>${fmtPct(flavio.percentualValidos)}</span></div></div>
      <div class="place-support-grid">
        <div><small>👥 Torcedores neutros</small><strong>${fmtInt(neutros)}</strong><span>votos nos demais candidatos</span></div>
        <div><small>🪑 Não entraram em campo</small><strong>${fmtInt(l.naoVotaram)}</strong><span>eleitores que não compareceram</span></div>
        <div><small>🚩 Fora de jogo</small><strong>${fmtInt(fora)}</strong><span>brancos + nulos</span></div>
      </div>
      <div class="local-turn"><div class="game-label">🔥 DÁ PRA VIRAR?</div><div class="local-turn-total"><span>Fora dos dois finalistas</span><strong>${fmtInt(totalFora)}</strong></div>${viraMessage(lula.votos,flavio.votos,totalFora)}</div>
      ${validLatLon(l.latitude,l.longitude)?`<button class="link-button map-place-btn no-export" type="button" data-lat="${escAttr(l.latitude)}" data-lon="${escAttr(l.longitude)}" data-name="${escAttr(l.nome||'')}" data-code="${escAttr(code)}">Ver no mapa</button>`:''}
    </div>
  </details>`;
}

function coordNumber(v){
  if(v===null || v===undefined) return null;
  const raw=String(v).trim();
  if(!raw) return null;
  const n=Number(raw.replace(',','.'));
  return isFinite(n)?n:null;
}

function validLatLon(lat,lon){
  const la=coordNumber(lat), lo=coordNumber(lon);
  if(la===null || lo===null) return false;
  if(Math.abs(la)>90 || Math.abs(lo)>180) return false;
  if(la===0 && lo===0) return false;
  return true;
}

function renderMapSafe(){
  try{
    renderMap();
  }catch(e){
    console.error('Erro no mapa:',e);
    destroyMap();
    const el=$('miniMap');
    if(el) el.innerHTML='<div class="map-placeholder">Mapa indisponível nesta consulta.</div>';
  }
}

// -----------------------------------------------------------------------------
// MAPA DE CAMPO — OpenStreetMap + limite oficial IBGE + locais TSE
// -----------------------------------------------------------------------------
function destroyMap(){
  if(state.map){ try{ state.map.remove(); }catch(e){} }
  state.map=null; state.mapBoundary=null; state.mapMarkers={};
}

function renderMap(){
  const el=$('miniMap');
  if(!el) return;
  if(state.geoError){
    el.innerHTML='<div class="map-placeholder">Mapa indisponível nesta consulta.</div>';
    return;
  }
  if(!state.geo || !state.dashboard){
    el.innerHTML='<div class="map-placeholder">Carregando mapa...</div>';
    return;
  }
  if(typeof L==='undefined'){
    el.innerHTML='<div class="map-placeholder">Mapa indisponível nesta consulta.</div>';
    return;
  }

  destroyMap();
  el.innerHTML='<div id="leafletMap" class="leaflet-map" aria-label="Mapa do município e locais de votação"></div>';
  const map=L.map('leafletMap',{scrollWheelZoom:true,zoomControl:true,preferCanvas:true});
  state.map=map;

  // Inicializa projeção/zoom antes de adicionar vetores. Isso evita o erro
  // _clipPoints / reading min do Leaflet quando a malha chega muito rápido.
  map.setView([-15.78,-47.93],4);

  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
    maxZoom:19,
    crossOrigin:true,
    attribution:'&copy; OpenStreetMap contributors'
  }).addTo(map);

  let boundary=null;
  try{
    boundary=L.geoJSON(state.geo,{style:{color:'#0B6B3A',weight:3,fillColor:'#0B6B3A',fillOpacity:.08}}).addTo(map);
    state.mapBoundary=boundary;
  }catch(e){
    console.error('Erro ao desenhar limite municipal:',e);
  }

  const places=((state.dashboard&&state.dashboard.locais)||[]).filter(l=>validLatLon(l.latitude,l.longitude));
  places.forEach(l=>{
    const code=String(l.codigo||'');
    const la=coordNumber(l.latitude), lo=coordNumber(l.longitude);
    const marker=L.circleMarker([la,lo],{
      radius:6,color:'#ffffff',weight:2,fillColor:'#D62828',fillOpacity:.95
    }).addTo(map);
    marker.bindTooltip(`${String(l.nome||'Local de votação')} — ${String(l.localidade||'')}`);
    marker.on('click',()=>openPlaceByCode(code));
    state.mapMarkers[code]=marker;
  });

  if(boundary && boundary.getBounds && boundary.getBounds().isValid()){
    map.fitBounds(boundary.getBounds(),{padding:[20,20]});
  }else if(places.length){
    map.fitBounds(L.latLngBounds(places.map(l=>[coordNumber(l.latitude),coordNumber(l.longitude)])),{padding:[20,20]});
  }

  setTimeout(()=>{ try{map.invalidateSize();}catch(e){} },100);
}

function focusPlaceOnMap(lat,lon,name,code){
  if(!state.map || !validLatLon(lat,lon)) return;
  const la=coordNumber(lat), lo=coordNumber(lon);
  state.map.setView([la,lo],Math.max(state.map.getZoom(),16),{animate:true});
  const marker=state.mapMarkers[String(code||'')];
  if(marker){ marker.setStyle({fillColor:'#F2B705',color:'#1F2937',radius:8}); marker.openTooltip(); }
  $('miniMap').scrollIntoView({behavior:'smooth',block:'center'});
}

function openPlaceByCode(code){
  const items=(state.dashboard&&state.dashboard.locais)||[];
  const l=items.find(x=>String(x.codigo||'')===String(code||''));
  if(!l) return;
  state.placeQuery=String(l.nome||'');
  state.placeLimit=40;
  const search=$('placeSearch');
  if(search) search.value=state.placeQuery;
  renderPlacesFiltered();
  setTimeout(()=>{
    const d=document.querySelector(`.place-accordion-item[data-place-code="${cssEscape(String(code||''))}"]`);
    if(d){ d.open=true; d.scrollIntoView({behavior:'smooth',block:'center'}); }
  },0);
}

// -----------------------------------------------------------------------------
// PROPOSTAS — seleção aleatória por assunto, com pareamento temático.
// Regra: Flávio ancora o assunto. Lula tenta o mesmo subtema, depois o mesmo
// tema e, só se não houver nada, entra com outra proposta para não deixar o
// lado vazio. Quando Flávio não tem proposta correspondente, aparece apenas
// "Bola murcha". Nunca mostramos "Sem proposta" para Lula.
// -----------------------------------------------------------------------------
function preparePlanos(groups){
  const lulas=[];
  const flavios=[];

  (groups||[]).forEach(g=>{
    (g.itens||[]).forEach(i=>{
      if(!i) return;
      const item=Object.assign({},i,{tema:i.tema||g.tema||'Outros'});
      const cand=norm(item.candidato);
      if(cand.startsWith('lula') && !isSemProposta(item)) lulas.push(item);
      else if(cand.includes('flavio') && !isSemProposta(item)) flavios.push(item);
    });
  });

  const rng=seededRandom(state.querySeed+101);
  const lulaPool=shuffleSeeded(lulas.slice(),rng);
  const flavioPool=shuffleSeeded(flavios.slice(),rng);
  const usedLula=new Set();
  const blocks=[];

  // Cada proposta real de Flávio recebe a proposta de Lula mais próxima possível.
  flavioPool.forEach(f=>{
    let lula=pickUnusedProposal(lulaPool,usedLula,x=>sameTemaSubtema(x,f));
    if(!lula) lula=pickUnusedProposal(lulaPool,usedLula,x=>sameTema(x,f));
    if(!lula) lula=pickUnusedProposal(lulaPool,usedLula,()=>true);
    if(lula) usedLula.add(proposalKey(lula));
    blocks.push(makePlanBlock(lula,f));
  });

  // Propostas de Lula que não entraram em nenhum par continuam acessíveis.
  // Nesses casos o lado de Flávio fica como Bola murcha.
  lulaPool.forEach(l=>{
    const key=proposalKey(l);
    if(usedLula.has(key)) return;
    usedLula.add(key);
    blocks.push(makePlanBlock(l,null));
  });

  const byTheme={};
  blocks.forEach(b=>{
    const k=b.tema||'Outros';
    (byTheme[k]=byTheme[k]||[]).push(b);
  });
  state.planOrder=roundRobinVaried(byTheme,state.querySeed+131);
}

function isSemProposta(item){
  return !item || norm(item.status).includes('sem proposta');
}

function proposalKey(i){
  if(!i) return '';
  return String(i.id||'') || [norm(i.tema),norm(i.subtema),norm(i.titulo),norm(i.candidato)].join('|');
}

function sameTema(a,b){
  return !!a && !!b && norm(a.tema)===norm(b.tema);
}

function sameTemaSubtema(a,b){
  if(!sameTema(a,b)) return false;
  const sa=norm(a.subtema||a.titulo||'');
  const sb=norm(b.subtema||b.titulo||'');
  return !!sa && sa===sb;
}

function pickUnusedProposal(pool,used,predicate){
  for(const item of pool){
    const key=proposalKey(item);
    if(used.has(key)) continue;
    if(predicate(item)) return item;
  }
  return null;
}

function makePlanBlock(lula,flavio){
  const anchor=flavio||lula||{};
  return {
    tema:anchor.tema||'Outros',
    lula:lula||null,
    flavio:flavio||null
  };
}

function renderPlanos(){
  const root=$('planosContent');
  const blocks=state.planOrder||[];
  if(!blocks.length){
    root.innerHTML='<div class="empty-state">Configure PLANILHA_ID para carregar PLANOS_2026.</div>';
    $('outrosTemasBtn').classList.add('hidden');
    return;
  }

  const shown=state.showAllPlans?blocks:blocks.slice(0,12);
  root.innerHTML=shown.map(b=>{
    const lulaHtml=proposalCard(b.lula,'lula','Lula');
    const flavioHtml=proposalCard(b.flavio,'flavio','Flávio Bolsonaro');
    const single=(!lulaHtml || !flavioHtml)?' single':'';
    return `<div class="theme-block">
      <div class="theme-title"><span class="area-label">${esc(b.tema||'Outros')}</span></div>
      <div class="proposal-grid${single}">${lulaHtml}${flavioHtml}</div>
    </div>`;
  }).join('');

  const btn=$('outrosTemasBtn');
  if(blocks.length<=12){ btn.classList.add('hidden'); return; }
  btn.classList.remove('hidden');
  btn.textContent=state.showAllPlans?'Mostrar seleção de 12':`Ver todas as propostas (${blocks.length})`;
}

function togglePlanos(){ state.showAllPlans=!state.showAllPlans; renderPlanos(); }

function proposalCard(item,cls,label){
  const sem=isSemProposta(item);

  // Lula nunca recebe o rótulo "Sem proposta".
  if(sem && cls==='lula') return '';

  // Para Flávio, ausência vira apenas Bola murcha + símbolo próprio.
  if(sem){
    return `<article class="proposal ${cls} proposal-murcha">
      <div class="proposal-head"><span class="candidate">${esc(label)}</span><span class="status murcha">${deflatedBallSvg()} Bola murcha</span></div>
    </article>`;
  }

  return `<article class="proposal ${cls}">
    <div class="proposal-head"><span class="candidate">${esc(label)}</span></div>
    <div class="proposal-topic">${esc(item.tema||'Outros')}${item.subtema?` · ${esc(item.subtema)}`:''}</div>
    <h4>${esc(item.titulo||item.subtema||item.tema)}</h4>
    <p>${esc(item.resumo||'')}</p>
    <div class="source">${esc(item.fonte||'')}${item.paginas?' · pág. '+esc(item.paginas):''}</div>
  </article>`;
}

function deflatedBallSvg(){
  return `<svg class="deflated-ball-svg" viewBox="0 0 52 34" aria-hidden="true" focusable="false">
    <path d="M4 18C5.5 8.2 14.8 3 27 4c11.7.9 20 6.3 20.7 14.1.7 7.3-7.2 11.9-20.4 11.2C13.9 28.6 2.9 25.4 4 18Z" fill="currentColor" opacity=".14"/>
    <path d="M4 18C5.5 8.2 14.8 3 27 4c11.7.9 20 6.3 20.7 14.1.7 7.3-7.2 11.9-20.4 11.2C13.9 28.6 2.9 25.4 4 18Z" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linejoin="round"/>
    <path d="m22.3 11.4 6.4-1.8 5.1 4.4-1.8 6.2-7 1.1-4.7-4.3 2-5.6Z" fill="currentColor" opacity=".72"/>
    <path d="M22.3 11.4 15.7 8M33.8 14l6.4-2.3M25 21.3l-4.3 5.6M32 20.2l6.7 5.1M20.3 17l-7.9 2.6" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>
    <path d="M9.7 24.5c8.9-3.1 23.4-2.8 32.1.5" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" opacity=".75"/>
  </svg>`;
}

// -----------------------------------------------------------------------------
// RETROSPECTO — Lula x Bolsonaro por tema.
// Primeiro tenta o mesmo subtema; depois outro fato dentro da mesma área.
// Fatos sem par permanecem visíveis sozinhos para que "ver tudo" não oculte nada.
// A progressão continua contando CARDS: 16 -> 32 -> 50 -> tudo.
// -----------------------------------------------------------------------------
function prepareRetrospecto(items){
  const byTheme={};
  (items||[]).forEach(i=>{
    const k=i.tema||'Outros';
    (byTheme[k]=byTheme[k]||[]).push(i);
  });

  const rng=seededRandom(state.querySeed+707);
  const rowsByTheme={};

  Object.keys(byTheme).forEach(theme=>{
    const arr=shuffleSeeded((byTheme[theme]||[]).slice(),rng);
    const lula=arr.filter(x=>retroGovKind(x)==='lula');
    const bolso=arr.filter(x=>retroGovKind(x)==='bolsonaro');
    const outros=arr.filter(x=>!['lula','bolsonaro'].includes(retroGovKind(x)));
    const usedBolso=new Set();
    const rows=[];
    const lulaLeft=[];

    // 1) pares exatos por subtema.
    lula.forEach(l=>{
      const idx=bolso.findIndex((b,ix)=>!usedBolso.has(ix) && sameRetroSubtema(l,b));
      if(idx>=0){
        usedBolso.add(idx);
        rows.push({tema:theme,lula:l,bolsonaro:bolso[idx]});
      }else{
        lulaLeft.push(l);
      }
    });

    // 2) pares restantes dentro do mesmo tema.
    const bolsoLeft=bolso.map((b,ix)=>({b,ix})).filter(x=>!usedBolso.has(x.ix));
    const pairCount=Math.min(lulaLeft.length,bolsoLeft.length);
    for(let i=0;i<pairCount;i++){
      rows.push({tema:theme,lula:lulaLeft[i],bolsonaro:bolsoLeft[i].b});
    }

    // 3) sobras aparecem sozinhas; nenhuma informação é descartada.
    lulaLeft.slice(pairCount).forEach(l=>rows.push({tema:theme,lula:l,bolsonaro:null}));
    bolsoLeft.slice(pairCount).forEach(x=>rows.push({tema:theme,lula:null,bolsonaro:x.b}));
    outros.forEach(x=>rows.push({tema:theme,outro:x,lula:null,bolsonaro:null}));

    rowsByTheme[theme]=shuffleSeeded(rows,rng);
  });

  state.retroOrder=roundRobinVaried(rowsByTheme,state.querySeed+733);
  state.retroLimit=16;
}

function retroGovKind(i){
  const g=norm(i&&i.governo||'');
  if(g.includes('lula')) return 'lula';
  if(g.includes('bolsonaro') || g.includes('bolso')) return 'bolsonaro';
  return 'outro';
}

function sameRetroSubtema(a,b){
  const sa=norm((a&&a.subtema)||(a&&a.titulo)||'');
  const sb=norm((b&&b.subtema)||(b&&b.titulo)||'');
  return !!sa && sa===sb;
}

function retroRowCards(row){
  return [row.lula,row.bolsonaro,row.outro].filter(Boolean);
}

function retroTotalCards(){
  return (state.retroOrder||[]).reduce((n,row)=>n+retroRowCards(row).length,0);
}

function retroRowsForLimit(limit){
  const out=[];
  let count=0;
  for(const row of (state.retroOrder||[])){
    const cards=retroRowCards(row);
    if(!cards.length) continue;
    if(count+cards.length>limit && count>0) break;
    out.push(row);
    count+=cards.length;
    if(count>=limit) break;
  }
  return {rows:out,count:count};
}

function renderRetrospecto(){
  const root=$('retrospectoContent');
  const total=retroTotalCards();
  const btn=$('retroMoreBtn');
  if(!total){
    root.innerHTML='<div class="empty-state">Preencha GOL_BOLA_MURCHA. Cada fato nacional deve ter resumo, indicador/resultado e fonte.</div>';
    btn.classList.add('hidden');
    return;
  }

  const selection=retroRowsForLimit(state.retroLimit);
  root.innerHTML=selection.rows.map(retroPairRow).join('');

  if(selection.count>=total){
    btn.classList.add('hidden');
  }else{
    btn.classList.remove('hidden');
    const next=state.retroLimit<32?32:state.retroLimit<50?50:total;
    btn.textContent=next>=total?`Ver todo o retrospecto (${total})`:`Ver mais (${next})`;
  }
}

function expandRetrospecto(){
  const total=retroTotalCards();
  if(state.retroLimit<32) state.retroLimit=Math.min(32,total);
  else if(state.retroLimit<50) state.retroLimit=Math.min(50,total);
  else state.retroLimit=total;
  renderRetrospecto();
}

function retroPairRow(row){
  const cards=retroRowCards(row);
  const single=cards.length===1?' single':'';
  return `<div class="retro-pair">
    <div class="retro-pair-title"><span class="area-label">${esc(row.tema||'Outros')}</span></div>
    <div class="retro-grid-national${single}">${cards.map(retroCard).join('')}</div>
  </div>`;
}

function retroStatusKind(i){
  const s=norm(i&&i.status||'');
  if(s.includes('murcha')) return 'murcha';
  if(s==='gol' || s.startsWith('gol ')) return 'gol';
  return '';
}

function retroCard(i){
  const status=retroStatusKind(i);
  const badge=status==='murcha'
    ? `<span class="status murcha">${deflatedBallSvg()} Bola murcha</span>`
    : status==='gol'
      ? '<span class="status gol"><span class="ball"></span> GOL</span>'
      : '';
  const cls=status||'neutro';
  return `<article class="retro ${cls}">
    <div class="proposal-head"><strong>${esc(i.governo||'')}</strong>${badge}</div>
    <div class="proposal-topic">${esc(i.tema||'Outros')}${i.subtema?` · ${esc(i.subtema)}`:''}</div>
    <h4>${esc(i.titulo||i.subtema||i.tema)}</h4>
    <p>${esc(i.resumo||'')}</p>
    ${i.indicador?`<div class="source"><b>Indicador:</b> ${esc(i.indicador)}</div>`:''}
    ${i.fonte?`<div class="source"><b>Fonte:</b> ${esc(i.fonte)}</div>`:''}
    ${i.link?`<div class="source"><a href="${escAttr(safeUrl(i.link))}" target="_blank" rel="noopener">Saiba mais</a></div>`:''}
  </article>`;
}

function roundRobinVaried(byTheme,seed,alternateStatus){
  const rng=seededRandom(seed||1);
  const themes=shuffleSeeded(Object.keys(byTheme),rng);
  const queues={};
  themes.forEach(t=>{ queues[t]=shuffleSeeded((byTheme[t]||[]).slice(),rng); });
  const out=[];
  let desiredMurcha=false;
  let remaining=true;
  while(remaining){
    remaining=false;
    for(const t of themes){
      const q=queues[t];
      if(!q || !q.length) continue;
      remaining=true;
      let idx=0;
      if(alternateStatus){
        const wanted=desiredMurcha;
        const found=q.findIndex(x=>norm(x.status).includes('murcha')===wanted);
        if(found>=0) idx=found;
      }
      out.push(q.splice(idx,1)[0]);
      desiredMurcha=!desiredMurcha;
    }
  }
  return out;
}

function shuffleSeeded(arr,rng){
  const a=arr.slice();
  for(let i=a.length-1;i>0;i--){ const j=Math.floor(rng()*(i+1)); [a[i],a[j]]=[a[j],a[i]]; }
  return a;
}
function hashSeed(s){ let h=2166136261>>>0; for(const ch of String(s||'')){h^=ch.charCodeAt(0);h=Math.imul(h,16777619);} return h>>>0 || 1; }
function seededRandom(seed){ let x=(seed>>>0)||1; return function(){ x^=x<<13; x^=x>>>17; x^=x<<5; return (x>>>0)/4294967296; }; }

// -----------------------------------------------------------------------------
// PLANO DE JOGO — 3 cards configuráveis + PDF/WhatsApp
// -----------------------------------------------------------------------------
function renderPlanoDeJogo(items){
  const root=$('planoJogoCards');
  if(!items.length){
    root.innerHTML='<div class="empty-state game-plan-empty">Crie a aba <b>PLANO_DE_JOGO</b> na planilha para configurar até três links de interesse.</div>';
    return;
  }
  root.innerHTML=items.slice(0,3).map((i,n)=>`<article class="game-plan-card"><span class="game-plan-number">${n+1}</span><div><h4>${esc(i.titulo||'Link de interesse')}</h4>${i.texto?`<p>${esc(i.texto)}</p>`:''}${i.link?`<a class="game-plan-link" href="${escAttr(safeUrl(i.link))}" target="_blank" rel="noopener">${esc(i.textoBotao||'Abrir')}</a>`:''}</div></article>`).join('');
}

async function exportDashboardPdf(share){
  if(!state.dashboard || !state.selected){ alert('Selecione um município primeiro.'); return; }
  if(typeof html2canvas==='undefined' || !window.jspdf || !window.jspdf.jsPDF){
    alert('O recurso de PDF não conseguiu carregar. Atualize a página e tente novamente.');
    return;
  }

  setLoading(true,share?'Preparando PDF para compartilhar...':'Gerando PDF...');
  let stage=null;
  try{
    const temp=buildPdfExportNode();

    // O conteúdo precisa existir no fluxo normal da página para o html2canvas
    // conseguir rasterizar. O overlay de loading fica por cima enquanto isso.
    stage=document.createElement('div');
    stage.setAttribute('aria-hidden','true');
    Object.assign(stage.style,{
      position:'absolute',
      left:'0',
      top:'0',
      width:'1050px',
      minHeight:'100vh',
      background:'#ffffff',
      zIndex:'90',
      overflow:'visible',
      pointerEvents:'none'
    });

    Object.assign(temp.style,{
      position:'relative',
      left:'auto',
      top:'auto',
      width:'1050px',
      minHeight:'0',
      zIndex:'auto',
      overflow:'visible',
      opacity:'1',
      visibility:'visible',
      transform:'none',
      background:'#ffffff'
    });

    stage.appendChild(temp);
    document.body.appendChild(stage);

    if(document.fonts && document.fonts.ready){
      try{ await document.fonts.ready; }catch(e){}
    }
    await waitForImages(temp);
    await waitAnimationFrames(2);

    const filename=`Time-da-Virada-${slug(state.selected.nome)}-${state.selected.uf}.pdf`;
    const blob=await renderPdfByBlocks(temp);

    if(share) await sharePdfBlob(blob,filename);
    else downloadBlob(blob,filename);
  }catch(e){
    console.error('Erro ao gerar PDF:',e);
    alert('Não foi possível gerar o PDF. Abra o Console (F12) se quiser me enviar o erro técnico.');
  }finally{
    if(stage&&stage.parentNode) stage.parentNode.removeChild(stage);
    setLoading(false);
  }
}

function buildPdfExportNode(){
  const wrapper=document.createElement('div');
  wrapper.className='pdf-export-root';

  const head=document.querySelector('.topbar').cloneNode(true);
  const content=$('content').cloneNode(true);
  const foot=document.querySelector('.footer').cloneNode(true);
  content.classList.remove('hidden');

  [...content.querySelectorAll('.no-export,button,input,.place-search-wrap')].forEach(x=>x.remove());

  // Locais de votação: somente os que estavam abertos na tela original.
  const openCodes=new Set([...document.querySelectorAll('.place-accordion-item[open]')]
    .map(d=>String(d.dataset.placeCode||'')));
  const cloneList=content.querySelector('#placesList');
  if(cloneList){
    [...cloneList.querySelectorAll('.place-accordion-item')].forEach(d=>{
      const code=String(d.dataset.placeCode||'');
      if(!openCodes.has(code)) d.remove();
      else d.setAttribute('open','');
    });
    if(!cloneList.children.length){
      cloneList.innerHTML='<div class="pdf-place-note">Nenhum local de votação estava aberto na tela.</div>';
    }
  }

  [...content.querySelectorAll('#retroMoreBtn,#outrosTemasBtn,#placesMoreBtn')].forEach(x=>x.remove());

  wrapper.appendChild(head);
  wrapper.appendChild(content);
  wrapper.appendChild(foot);
  return wrapper;
}

async function renderPdfByBlocks(root){
  const {jsPDF}=window.jspdf;
  const pdf=new jsPDF({unit:'mm',format:'a4',orientation:'portrait',compress:true});
  const pageW=pdf.internal.pageSize.getWidth();
  const pageH=pdf.internal.pageSize.getHeight();
  const marginX=8;
  const marginTop=8;
  const marginBottom=9;
  const usableW=pageW-(marginX*2);
  const usableH=pageH-marginTop-marginBottom;
  const gapMm=3;

  const content=root.querySelector('#content');
  const blocks=[
    root.querySelector('.topbar'),
    ...(content ? [...content.children].filter(el=>el.classList.contains('section-card')) : []),
    root.querySelector('.footer')
  ].filter(Boolean);

  let y=marginTop;
  let hasAnything=false;

  for(const block of blocks){
    // Dá tempo para o navegador terminar o layout de cada bloco.
    block.scrollIntoView({block:'nearest'});
    await waitAnimationFrames(1);

    let canvas;
    try{
      canvas=await html2canvas(block,{
        scale:1.35,
        useCORS:true,
        allowTaint:false,
        backgroundColor:'#ffffff',
        logging:false,
        scrollX:0,
        scrollY:0,
        windowWidth:1100,
        removeContainer:true
      });
    }catch(err){
      console.warn('Bloco ignorado no PDF:',err,block);
      continue;
    }

    if(!canvas || canvas.width<10 || canvas.height<10) continue;
    if(!canvasHasVisibleContent(canvas)){
      console.warn('Canvas em branco ignorado no PDF:',block);
      continue;
    }

    hasAnything=true;
    const mmPerPx=usableW/canvas.width;
    const blockHmm=canvas.height*mmPerPx;

    if(blockHmm<=usableH){
      if(y>marginTop && y+blockHmm>pageH-marginBottom){
        pdf.addPage();
        y=marginTop;
      }
      const img=canvas.toDataURL('image/jpeg',0.94);
      pdf.addImage(img,'JPEG',marginX,y,usableW,blockHmm,undefined,'FAST');
      y+=blockHmm+gapMm;
      continue;
    }

    // Blocos maiores que uma página são fatiados para evitar canvas/PDF vazio.
    let srcY=0;
    while(srcY<canvas.height){
      if(y>marginTop+0.5){
        pdf.addPage();
        y=marginTop;
      }

      const remainingMm=(pageH-marginBottom)-y;
      let slicePx=Math.floor(remainingMm/mmPerPx);
      if(slicePx<80){
        pdf.addPage();
        y=marginTop;
        slicePx=Math.floor(usableH/mmPerPx);
      }
      slicePx=Math.min(slicePx,canvas.height-srcY);

      const piece=document.createElement('canvas');
      piece.width=canvas.width;
      piece.height=slicePx;
      const ctx=piece.getContext('2d');
      ctx.fillStyle='#ffffff';
      ctx.fillRect(0,0,piece.width,piece.height);
      ctx.drawImage(canvas,0,srcY,canvas.width,slicePx,0,0,canvas.width,slicePx);

      const pieceHmm=slicePx*mmPerPx;
      const img=piece.toDataURL('image/jpeg',0.94);
      pdf.addImage(img,'JPEG',marginX,y,usableW,pieceHmm,undefined,'FAST');
      y+=pieceHmm;
      srcY+=slicePx;

      if(srcY<canvas.height){
        pdf.addPage();
        y=marginTop;
      }else{
        y+=gapMm;
      }
    }
  }

  if(!hasAnything){
    throw new Error('Nenhum bloco visível foi rasterizado para o PDF.');
  }

  return pdf.output('blob');
}

function canvasHasVisibleContent(canvas){
  try{
    const ctx=canvas.getContext('2d',{willReadFrequently:true});
    const cols=16, rows=20;
    for(let iy=0;iy<rows;iy++){
      for(let ix=0;ix<cols;ix++){
        const x=Math.min(canvas.width-1,Math.floor((ix+.5)*canvas.width/cols));
        const y=Math.min(canvas.height-1,Math.floor((iy+.5)*canvas.height/rows));
        const d=ctx.getImageData(x,y,1,1).data;
        if(d[3]>0 && (d[0]<247 || d[1]<247 || d[2]<247)) return true;
      }
    }
    return false;
  }catch(e){
    // Canvas com restrição de leitura ainda pode ser exportado; não o descarte.
    return true;
  }
}

function waitAnimationFrames(n){
  return new Promise(resolve=>{
    const step=()=>{ if(--n<=0) resolve(); else requestAnimationFrame(step); };
    requestAnimationFrame(step);
  });
}

async function sharePdfBlob(blob,filename){
  const file=new File([blob],filename,{type:'application/pdf'});
  const text=`Time da Virada — resumo de ${state.selected.nome}/${state.selected.uf}.`;
  if(navigator.share && navigator.canShare && navigator.canShare({files:[file]})){
    try{ await navigator.share({title:'Time da Virada',text:text,files:[file]}); return; }
    catch(e){ if(e&&e.name==='AbortError') return; }
  }
  downloadBlob(blob,filename);
  const msg=`${text}\nO PDF foi baixado no aparelho para você anexar nesta conversa.`;
  window.open('https://wa.me/?text='+encodeURIComponent(msg),'_blank','noopener');
}

function downloadBlob(blob,filename){
  const url=URL.createObjectURL(blob);
  const a=document.createElement('a'); a.href=url; a.download=filename; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(()=>URL.revokeObjectURL(url),1500);
}
function waitForImages(node){
  const imgs=[...node.querySelectorAll('img')];
  return Promise.all(imgs.map(img=>img.complete?Promise.resolve():new Promise(r=>{img.onload=r;img.onerror=r;})));
}
function slug(v){return norm(v).replace(/\s+/g,'-')||'municipio'}
function safeUrl(v){ const s=String(v||'').trim(); return /^https?:\/\//i.test(s)?s:'#'; }

function renderFontes(items){
  $('fontesContent').innerHTML=items.map(f=>`<div class="fonte-item"><b>${esc(f.orgao)} — ${esc(f.nome)}</b><br>${esc(f.uso||'')}${f.link?` · <a href="${escAttr(safeUrl(f.link))}" target="_blank" rel="noopener">abrir fonte</a>`:''}</div>`).join('');
}

function fmtIndicator(i){
  const v=Number(i.valor); if(!isFinite(v)) return '—';
  if(i.unidade==='R$') return v.toLocaleString('pt-BR',{style:'currency',currency:'BRL',maximumFractionDigits:2});
  if(i.unidade==='%') return v.toLocaleString('pt-BR',{maximumFractionDigits:2})+'%';
  if(i.unidade==='pessoas') return fmtInt(v);
  return v.toLocaleString('pt-BR',{maximumFractionDigits:2})+(i.unidade?' '+i.unidade:'');
}
function signedPp(v){const n=Number(v);if(!isFinite(n))return '—';return (n>0?'+':'')+n.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:2})+' p.p.'}
function sourceShort(k){return String(k||'').startsWith('IBGE')?'IBGE':String(k||'').split('_')[0]}
function fmtInt(v){const n=Number(v);return isFinite(n)?Math.round(n).toLocaleString('pt-BR'):'—'}
function fmtPct(v){const n=Number(v);return isFinite(n)?n.toLocaleString('pt-BR',{minimumFractionDigits:1,maximumFractionDigits:2})+'%':'—'}
function norm(v){return String(v||'').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[^a-z0-9 ]+/g,' ').replace(/\s+/g,' ').trim()}
function esc(v){return String(v==null?'':v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
function escAttr(v){return esc(v).replaceAll('`','&#096;')}
function cssEscape(v){return String(v||'').replace(/(["\\])/g,'\\$1')}
function setLoading(show,text){$('loadingText').textContent=text||'Carregando...';$('loading').classList.toggle('show',!!show)}
function showError(err){setLoading(false);alert(err&&err.message?err.message:String(err||'Erro inesperado'))}
