(() => {
  const status=document.getElementById('adminStatus'),list=document.getElementById('adminList');
  const states={pending:'Pendente',approved:'Publicado',hidden:'Oculto'};
  async function load(){
    list.replaceChildren();status.textContent='Carregando registros...';
    try{
      const response=await fetch('/api/agenda/admin/events',{cache:'no-store'});
      const result=await response.json();if(!response.ok)throw Error(result.error||'Entre com o e-mail autorizado.');
      status.textContent=result.events.length+' registros recentes. Ocultar retira o evento do mapa e permite restaurá-lo.';
      result.events.forEach(event=>{
        const card=document.createElement('article');card.className='admin-card';
        const heading=document.createElement('h2');heading.textContent=event.activity;card.append(heading);
        [states[event.status],event.date+' · '+event.city,event.place,event.participants+' participantes estimados','Apelido público: '+(event.nickname||'não informado'),event.description,'Coordenadas do local público: '+event.lat+', '+event.lng,'Protocolo: '+event.id].forEach(text=>{const p=document.createElement('p');p.textContent=text;card.append(p)});
        [['approved','Aprovar e publicar'],['hidden','Ocultar'],['pending','Voltar para revisão']].forEach(([value,label])=>{
          const button=document.createElement('button');button.className='secondary-button';button.textContent=label;button.disabled=value===event.status;
          button.addEventListener('click',async()=>{
            card.querySelectorAll('button').forEach(b=>b.disabled=true);
            try{
              const response=await fetch('/api/agenda/admin/events/'+event.id,{method:'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({status:value})});
              const result=await response.json();if(!response.ok)throw Error(result.error||'Não foi possível alterar.');
              await load();
            }catch(error){status.textContent=error.message;card.querySelectorAll('button').forEach(b=>b.disabled=false)}
          });card.append(button);
        });
        list.append(card);
      });
    }catch(error){status.textContent=error.message||'Não foi possível acessar o painel.'}
  }
  document.getElementById('adminRefresh').addEventListener('click',load);load();
})();