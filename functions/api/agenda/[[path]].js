const headers={'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff'};
const reply=(body,status=200)=>new Response(JSON.stringify(body),{status,headers});
const fault=(message,status=400)=>{throw Object.assign(new Error(message),{status})};
const text=(value,max,required=true)=>{if(typeof value!=='string'||value.length>max||(required&&!value.trim()))fault('Confira os campos obrigatórios e os limites de tamanho.');return value.trim()};
const b64=value=>Uint8Array.from(atob(value.replace(/-/g,'+').replace(/_/g,'/')),c=>c.charCodeAt(0));
let keyCache;
export async function authenticate(request,env){
  if(!env.ACCESS_TEAM_DOMAIN||!env.ACCESS_AUD||!env.ADMIN_EMAIL)fault('Acesso administrativo ainda não configurado.',503);
  const issuer='https://'+env.ACCESS_TEAM_DOMAIN;
  if(!/^https:\/\/[a-z0-9-]+\.cloudflareaccess\.com$/.test(issuer))fault('Configuração de acesso inválida.',503);
  const token=request.headers.get('Cf-Access-Jwt-Assertion')||'';
  if(token.length>12000)fault('Acesso negado.',403);
  try{
    const parts=token.split('.');if(parts.length!==3)throw Error();
    const decode=part=>JSON.parse(new TextDecoder().decode(b64(part)));
    const head=decode(parts[0]),claim=decode(parts[1]),now=Math.floor(Date.now()/1000);
    if(head.alg!=='RS256'||!head.kid||claim.iss!==issuer||!Array.isArray(claim.aud)||!claim.aud.includes(env.ACCESS_AUD)||!Number.isFinite(claim.exp)||claim.exp<=now||(claim.nbf&&claim.nbf>now+30)||typeof claim.email!=='string'||claim.email.toLowerCase()!==env.ADMIN_EMAIL.toLowerCase())throw Error();
    if(!keyCache||keyCache.issuer!==issuer||keyCache.until<Date.now()||!keyCache.keys.some(k=>k.kid===head.kid)){
      const response=await fetch(issuer+'/cdn-cgi/access/certs',{signal:AbortSignal.timeout(5000)});
      if(!response.ok)throw Error();const data=await response.json();
      keyCache={issuer,keys:data.keys,until:Date.now()+300000};
    }
    const jwk=keyCache.keys.find(k=>k.kid===head.kid&&k.kty==='RSA');if(!jwk)throw Error();
    const key=await crypto.subtle.importKey('jwk',jwk,{name:'RSASSA-PKCS1-v1_5',hash:'SHA-256'},false,['verify']);
    if(!await crypto.subtle.verify('RSASSA-PKCS1-v1_5',key,b64(parts[2]),new TextEncoder().encode(parts[0]+'.'+parts[1])))throw Error();
    return claim.email;
  }catch{fault('Acesso negado. Entre com o e-mail autorizado.',403)}
}
export function validateEvent(body){
  const event={activity:text(body.activity,100),date:text(body.date,10),city:text(body.city,100),place:text(body.place,160),nickname:text(body.nickname||'',80,false),description:text(body.description,500)};
  if(!/^\d{4}-\d{2}-\d{2}$/.test(event.date)||!Number.isFinite(Date.parse(event.date+'T12:00:00Z'))||new Date(event.date+'T12:00:00Z').toISOString().slice(0,10)!==event.date||event.date<'2020-01-01'||event.date>new Date(Date.now()+86400000).toISOString().slice(0,10))fault('Informe uma data válida para um evento já realizado.');
  if(!Number.isInteger(body.participants)||body.participants<1||body.participants>100000)fault('Informe uma quantidade inteira de participantes.');
  if(!Number.isFinite(body.lat)||body.lat< -34||body.lat>6||!Number.isFinite(body.lng)||body.lng< -74||body.lng> -34)fault('Marque no mapa um local público no Brasil.');
  if(body.consent!==true||body.publicPlace!==true)fault('Confirme o aviso de publicação e que o local é público.');
  if(event.nickname&&(/@|https?:\/\/|\d{7,}/i.test(event.nickname)))fault('Use um apelido fictício sem contato pessoal.');
  return {...event,participants:body.participants,lat:Math.round(body.lat*10000)/10000,lng:Math.round(body.lng*10000)/10000};
}
async function readBody(request){
  if(!request.headers.get('Content-Type')?.startsWith('application/json'))fault('Formato inválido.',415);
  if(Number(request.headers.get('Content-Length')||0)>10000)fault('Envio muito grande.',413);
  const reader=request.body?.getReader();if(!reader)fault('Envio vazio.');const chunks=[];let size=0;
  while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>10000){await reader.cancel();fault('Envio muito grande.',413)}chunks.push(value)}
  const bytes=new Uint8Array(size);let position=0;for(const chunk of chunks){bytes.set(chunk,position);position+=chunk.length}
  try{return JSON.parse(new TextDecoder().decode(bytes))}catch{fault('Envio inválido.')}
}
const hash=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),v=>v.toString(16).padStart(2,'0')).join('');
const columns='id, activity, event_date AS date, city, place, nickname, description, participants, lat, lng';
export async function onRequest({request,env}){
  try{
    const route=new URL(request.url).pathname.replace(/\/+$/,'');
    const admin=route.startsWith('/api/agenda/admin');
    if(admin)await authenticate(request,env);
    if(request.method!=='GET'&&request.headers.get('Origin')!==new URL(request.url).origin)fault('Origem do envio não autorizada.',403);
    if(route==='/api/agenda/config'&&request.method==='GET')return reply({enabled:!!env.AGENDA_DB&&env.AGENDA_ENABLED==='true'&&!!env.TURNSTILE_SECRET&&!!env.TURNSTILE_SITE_KEY&&!!env.AGENDA_RATE_SECRET&&!!env.ACCESS_TEAM_DOMAIN&&!!env.ACCESS_AUD&&!!env.ADMIN_EMAIL,siteKey:env.TURNSTILE_SITE_KEY||''});
    if(!env.AGENDA_DB||env.AGENDA_ENABLED!=='true')fault('A agenda está temporariamente indisponível. A consulta do site continua funcionando.',503);
    // Aggregate accesses only: no visitor identifiers or personal data.
    if(route==='/api/agenda/counter' && ['GET','POST'].includes(request.method)){
      const bucket='site-access-total-v1';
      const row=request.method==='POST'
        ? await env.AGENDA_DB.prepare('INSERT INTO agenda_rate (bucket,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(bucket,253402300799000).first()
        : await env.AGENDA_DB.prepare('SELECT attempts FROM agenda_rate WHERE bucket=?').bind(bucket).first();
      return reply({total:Number(row?.attempts||0),registrado:request.method==='POST'});
    }
    if(route==='/api/agenda/events'&&request.method==='GET'){
      const {results}=await env.AGENDA_DB.prepare('SELECT '+columns+" FROM agenda_events WHERE status='approved' ORDER BY event_date DESC, created_at DESC LIMIT 200").all();
      return reply({events:results});
    }
    if(route==='/api/agenda/events'&&request.method==='POST'){
      if(!env.TURNSTILE_SECRET||!env.AGENDA_RATE_SECRET)fault('Recebimento ainda não configurado.',503);
      const body=await readBody(request),event=validateEvent(body);
      if(body.website)fault('Envio inválido.');
      const token=text(body.token,2048);
      const verification=await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({secret:env.TURNSTILE_SECRET,response:token}),signal:AbortSignal.timeout(10000)});
      if(!verification.ok)fault('Não foi possível verificar o envio. Tente novamente.',503);
      const verified=await verification.json();
      if(!verified.success||verified.hostname!==new URL(request.url).hostname||verified.action!=='agenda')fault('Verifique a proteção do formulário e tente novamente.');
      const ip=request.headers.get('CF-Connecting-IP');if(!ip)fault('Envio indisponível.',503);
      const key=await hash(env.AGENDA_RATE_SECRET+'|'+ip+'|'+new Date().toISOString().slice(0,13));
      const rate=await env.AGENDA_DB.prepare('INSERT INTO agenda_rate (bucket,attempts,expires_at) VALUES (?,1,?) ON CONFLICT(bucket) DO UPDATE SET attempts=attempts+1 RETURNING attempts').bind(key,Date.now()+7200000).first();
      if(rate.attempts>10)fault('Limite temporário de envios atingido. Tente mais tarde.',429);
      const fingerprint=await hash([event.activity.toLowerCase(),event.date,event.city.toLowerCase(),event.place.toLowerCase()].join('|'));
      const id=crypto.randomUUID();
      const result=await env.AGENDA_DB.prepare("INSERT OR IGNORE INTO agenda_events (id,activity,event_date,city,place,nickname,description,participants,lat,lng,status,fingerprint,created_at,consent_version) VALUES (?,?,?,?,?,?,?,?,?,?,'pending',?,?,?)").bind(id,event.activity,event.date,event.city,event.place,event.nickname,event.description,event.participants,event.lat,event.lng,fingerprint,new Date().toISOString(),'agenda-v1').run();
      if(!result.meta.changes)fault('Já recebemos um registro semelhante desse evento.',409);
      await env.AGENDA_DB.prepare('DELETE FROM agenda_rate WHERE expires_at < ?').bind(Date.now()).run();
      return reply({id,status:'pending',message:'Registro recebido. Ele aparecerá no mapa somente após a revisão do responsável.'},201);
    }
    if(route==='/api/agenda/admin/events'&&request.method==='GET'){
      const {results}=await env.AGENDA_DB.prepare('SELECT '+columns+', status, created_at FROM agenda_events ORDER BY created_at DESC LIMIT 200').all();
      return reply({events:results});
    }
    const match=route.match(/^\/api\/agenda\/admin\/events\/([a-f0-9-]{36})$/);
    if(match&&request.method==='PATCH'){
      const body=await readBody(request);if(!['approved','hidden','pending'].includes(body.status))fault('Estado inválido.');
      const result=await env.AGENDA_DB.prepare('UPDATE agenda_events SET status=?, reviewed_at=? WHERE id=?').bind(body.status,new Date().toISOString(),match[1]).run();
      if(!result.meta.changes)fault('Registro não encontrado.',404);
      return reply({status:body.status});
    }
    return reply({error:'Não encontrado.'},404);
  }catch(error){return reply({error:error.status?error.message:'Não foi possível concluir. Tente novamente mais tarde.'},error.status||503)}
}
