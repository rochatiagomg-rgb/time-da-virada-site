(() => {
  const root=document.getElementById('agendaPreview');
  if(!root)return;
  const form=root.querySelector('#agendaForm'),feedback=root.querySelector('#agendaFeedback'),list=root.querySelector('#agendaExamples'),submit=form.querySelector('button[type="submit"]');
  let map,selectedMarker,selectedLocation,events=[],config,widget,turnstileToken='';
  const markers=[];
  let municipalityGeo=null;
  function centerMunicipality(){
    if(!map||!municipalityGeo)return;
    try{
      const bounds=L.geoJSON(municipalityGeo).getBounds();
      if(bounds.isValid()){map.invalidateSize();map.fitBounds(bounds,{padding:[18,18],maxZoom:12});}
    }catch{}
  }
  document.addEventListener('tdv:municipality',event=>{
    municipalityGeo=event.detail.geo||null;
    root.querySelector('#agendaMap').setAttribute('aria-label','Mapa dos eventos públicos aprovados — '+event.detail.name+' / '+event.detail.uf);
    if(municipalityGeo)centerMunicipality();
  });
  root.querySelector('#agendaSection').addEventListener('toggle',event=>{
    if(event.target.open&&map)requestAnimationFrame(()=>{map.invalidateSize();centerMunicipality();});
  });
  const notice=(message)=>{feedback.textContent=message;feedback.hidden=false};
  function paragraph(parent,text){const p=document.createElement('p');p.textContent=text;parent.append(p)}
  function renderEvents(){
    list.replaceChildren();
    if(!events.length){const p=document.createElement('p');p.className='agenda-notice';p.textContent='Aquecimento — os eventos aprovados aparecerão aqui.';list.append(p)}
    events.forEach(event=>{
      const card=document.createElement('article');card.className='agenda-event';
      const title=document.createElement('h4');title.textContent=event.activity;card.append(title);
      paragraph(card,event.place+' · '+event.city);
      paragraph(card,event.date.split('-').reverse().join('/')+' · '+event.participants+' participantes estimados');
      if(event.nickname)paragraph(card,'Registrado por: '+event.nickname);
      paragraph(card,event.description);
      paragraph(card,'Informação enviada pelo público · estimativa não verificada');
      list.append(card);
    });
    markers.splice(0).forEach(marker=>marker.remove());
    if(map)events.forEach(event=>{
      const popup=document.createElement('div');
      const title=document.createElement('strong');title.textContent=event.activity;popup.append(title);
      paragraph(popup,event.place+' · '+event.city);
      paragraph(popup,event.date.split('-').reverse().join('/')+' · '+event.participants+' participantes estimados');
      if(event.nickname)paragraph(popup,'Registrado por: '+event.nickname);
      paragraph(popup,'Informação enviada pelo público · estimativa não verificada');
      markers.push(L.circleMarker([event.lat,event.lng],{radius:9,color:'#69501f',fillColor:'#efce77',fillOpacity:1,weight:2}).addTo(map).bindPopup(popup));
    });
  }
  function ensureMap(){
    if(map){requestAnimationFrame(()=>{map.invalidateSize();centerMunicipality();});return}
    if(!window.L){root.querySelector('#agendaMap').textContent='Mapa indisponível. Tente recarregar a página.';return}
    map=L.map('agendaMap').setView([-15.78,-47.93],4);
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{maxZoom:19,attribution:'&copy; OpenStreetMap contributors'}).addTo(map);
    map.on('click',event=>{
      if(event.latlng.lat< -34||event.latlng.lat>6||event.latlng.lng< -74||event.latlng.lng> -34){notice('Escolha um local público no Brasil.');return}
      selectedLocation={lat:event.latlng.lat,lng:event.latlng.lng};
      if(selectedMarker)selectedMarker.remove();
      selectedMarker=L.circleMarker(event.latlng,{radius:11,color:'#fff',fillColor:'#6da6ff',fillOpacity:1,weight:3}).addTo(map);
      root.querySelector('#agendaLocation').textContent='Local selecionado: '+selectedLocation.lat.toFixed(4)+', '+selectedLocation.lng.toFixed(4)+'. Confira se corresponde ao local público do evento.';
    });
    renderEvents();requestAnimationFrame(()=>{map.invalidateSize();centerMunicipality();});
  }
  root.querySelector('#agendaExplore').addEventListener('toggle',event=>{if(event.target.open)ensureMap()});
  root.querySelector('#agendaChooseLocation').addEventListener('click',()=>{
    root.querySelector('#agendaExplore').open=true;ensureMap();
    root.querySelector('#agendaExplore').scrollIntoView({behavior:'smooth',block:'start'});
    notice('Amplie o mapa e clique no local público onde ocorreu o evento. O ponto azul indica sua seleção.');
  });
  root.querySelector('#agendaLocate').addEventListener('click',()=>{
    if(!navigator.geolocation){notice('Seu navegador não oferece localização. Escolha o ponto manualmente.');return}
    root.querySelector('#agendaExplore').open=true;ensureMap();
    navigator.geolocation.getCurrentPosition(position=>{
      // Localização apenas centraliza o mapa. O participante precisa selecionar um local público.
      map?.setView([position.coords.latitude,position.coords.longitude],15);
      notice('Mapa centralizado na sua região. Clique no local público do evento; sua localização não foi salva.');
    },()=>notice('Não foi possível obter a localização. Você pode escolher o ponto manualmente.'),{enableHighAccuracy:false,timeout:10000,maximumAge:60000});
  });
  const today=new Date();form.elements.date.max=[today.getFullYear(),String(today.getMonth()+1).padStart(2,'0'),String(today.getDate()).padStart(2,'0')].join('-');form.elements.date.min='2020-01-01';
  const updateSubmit=()=>{submit.disabled=!config?.enabled||!turnstileToken};
  function prepareProtection(){
    if(widget!==undefined||!window.turnstile||!config?.enabled)return;
    widget=turnstile.render(root.querySelector('#agendaProtection'),{sitekey:config.siteKey,action:'agenda',callback:token=>{turnstileToken=token;updateSubmit()},'expired-callback':()=>{turnstileToken='';updateSubmit()},'error-callback':()=>{turnstileToken='';updateSubmit();notice('Proteção indisponível. Recarregue a página para tentar novamente.')}});
  }
  root.querySelector('#agendaRegister').addEventListener('toggle',event=>{if(event.target.open)prepareProtection()});
  async function initialize(){
    try{
      const response=await fetch('/api/agenda/config',{cache:'no-store'});if(!response.ok)throw Error();
      config=await response.json();
      if(!config.enabled){notice('O recebimento de eventos ainda não está disponível. A consulta do site continua funcionando.');return}
      const responseEvents=await fetch('/api/agenda/events',{cache:'no-store'});if(!responseEvents.ok)throw Error();
      events=(await responseEvents.json()).events;renderEvents();
      const script=document.createElement('script');script.src='https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';script.onload=()=>{if(root.querySelector('#agendaRegister').open)prepareProtection()};script.onerror=()=>notice('Proteção indisponível. Tente novamente mais tarde.');document.head.append(script);
    }catch{notice('A agenda está temporariamente indisponível. As outras consultas continuam disponíveis.')}
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!form.reportValidity())return;
    if(!selectedLocation){notice('Marque no mapa o local público do evento antes de enviar.');return}
    if(!config?.enabled||!turnstileToken){notice('Aguarde a verificação do formulário.');return}
    const values=new FormData(form);
    const payload={activity:values.get('activity'),date:values.get('date'),city:values.get('city'),place:values.get('place'),nickname:values.get('nickname'),description:values.get('description'),participants:Number(values.get('participants')),consent:values.get('consent')==='on',publicPlace:values.get('publicPlace')==='on',website:values.get('website'),token:turnstileToken,...selectedLocation};
    submit.disabled=true;
    try{
      const response=await fetch('/api/agenda/events',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
      const result=await response.json();if(!response.ok)throw Error(result.error||'Não foi possível enviar.');
      notice(result.message+' Protocolo: '+result.id);form.reset();selectedLocation=undefined;selectedMarker?.remove();selectedMarker=undefined;root.querySelector('#agendaLocation').textContent='Nenhum local selecionado.';
    }catch(error){notice(error.message||'Não foi possível enviar. Tente novamente.')}
    finally{turnstileToken='';if(widget!==undefined)turnstile.reset(widget);updateSubmit()}
  });
  renderEvents();updateSubmit();initialize();
})();
