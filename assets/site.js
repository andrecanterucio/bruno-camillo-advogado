(function(){
  var NUM='5561998769797';
  var LEAD_API='https://sites.zacda.com.br/api/public/lead/bruno-camillo';
  var $=function(s,c){return (c||document).querySelector(s)};
  var $$=function(s,c){return [].slice.call((c||document).querySelectorAll(s))};
  var mobile=/Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
  function wa(msg){
    var t=encodeURIComponent(msg);
    return (mobile?'whatsapp://send?phone='+NUM+'&text=':'https://wa.me/'+NUM+'?text=')+t;
  }

  // tempo de OAB sempre atualizado
  var anos=$('#anos');if(anos)anos.textContent=Math.max(9,new Date().getFullYear()-2017);
  // pagina de area: ja pre-seleciona o assunto no formulario
  var da=document.body.getAttribute('data-area'),sel=$('#area');
  if(da&&sel){for(var i=0;i<sel.options.length;i++){if(sel.options[i].text===da){sel.selectedIndex=i}}}

  // progresso + nav
  var prog=$('#progress'),nav=$('#nav');
  function onScroll(){
    var h=document.documentElement.scrollHeight-innerHeight;
    prog.style.width=(h>0?scrollY/h*100:0)+'%';
    nav.classList.toggle('on',scrollY>40);
  }
  addEventListener('scroll',onScroll,{passive:true});onScroll();

  // menu mobile
  var b=$('#burger'),l=$('#links');
  function toggle(open){b.setAttribute('aria-expanded',open);l.classList.toggle('open',open);nav.classList.toggle('on',open||scrollY>40)}
  b.addEventListener('click',function(){toggle(b.getAttribute('aria-expanded')!=='true')});
  $$('#links a').forEach(function(a){a.addEventListener('click',function(){toggle(false)})});

  // reveal
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){e.target.classList.add('on');io.unobserve(e.target)}})},{threshold:.12,rootMargin:'0px 0px -40px 0px'});
    $$('.rv').forEach(function(el){io.observe(el)});
  }else{$$('.rv').forEach(function(el){el.classList.add('on')})}

  // links diretos de WhatsApp
  $$('[data-wa]').forEach(function(a){
    if(a.getAttribute('href')==='#contato')return; // CTA do hero rola até o formulário
    a.href=wa(a.dataset.wa);a.target='_blank';a.rel='noopener';
  });
  $('#wa').href=wa('Olá, Dr. Bruno. Vim pelo site e gostaria de conversar sobre um caso.');$('#wa').target='_blank';$('#wa').rel='noopener';

  // cartões de área pré-selecionam o assunto
  $$('.area').forEach(function(a){a.addEventListener('click',function(){var s=$('#area');for(var i=0;i<s.options.length;i++){if(s.options[i].text===a.dataset.area){s.selectedIndex=i}}})});


  // carrossel de avaliacoes (Google)
  var rt=$('#rev-track'),rp=$('#rev-prev'),rn=$('#rev-next');
  if(rt&&rp&&rn){
    var step=function(){var c=rt.querySelector('.rev-card');return c?c.offsetWidth+16:320};
    var upd=function(){rp.disabled=rt.scrollLeft<4;rn.disabled=rt.scrollLeft+rt.clientWidth>=rt.scrollWidth-4};
    rp.addEventListener('click',function(){rt.scrollBy({left:-step()})});
    rn.addEventListener('click',function(){rt.scrollBy({left:step()})});
    rt.addEventListener('scroll',upd,{passive:true});addEventListener('resize',upd);upd();
  }

  // máscara de telefone
  $('#tel').addEventListener('input',function(){
    var v=this.value.replace(/\D/g,'').slice(0,11);
    if(v.length>7)v='('+v.slice(0,2)+') '+v.slice(2,7)+'-'+v.slice(7);
    else if(v.length>2)v='('+v.slice(0,2)+') '+v.slice(2);
    else if(v.length)v='('+v;
    this.value=v;
  });

  // formulário -> WhatsApp
  $('#form').addEventListener('submit',function(e){
    e.preventDefault();
    var f=this,ok=true;
    ['nome','tel','area'].forEach(function(id){
      var el=$('#'+id),bad=!el.value.trim()||(id==='tel'&&el.value.replace(/\D/g,'').length<10);
      el.style.borderColor=bad?'#b3261e':'';if(bad&&ok){el.focus();ok=false}
    });
    if(!ok)return;
    var m='Olá, Dr. Bruno. Vim pelo site.\n\nNome: '+f.nome.value.trim()+'\nWhatsApp: '+f.tel.value+'\nAssunto: '+f.area.value+(f.msg.value.trim()?'\n\n'+f.msg.value.trim():'');
    // registra o contato no painel do cliente (ZACDA); nunca bloqueia o WhatsApp
    try{
      fetch(LEAD_API,{method:'POST',keepalive:true,headers:{'Content-Type':'application/json'},
        body:JSON.stringify({name:f.nome.value.trim(),whatsapp:f.tel.value,area:f.area.value,message:f.msg.value.trim(),website:f.website.value,source:'site'})
      }).catch(function(){});
    }catch(err){}
    try{window.gtag('event','generate_lead',{lead_area:f.area.value,page_path:location.pathname})}catch(err){}
    window.open(wa(m),'_blank','noopener');
  });
})();

/* ---- medicao (GA4) + eventos + aviso de cookies (LGPD) ----
   O GA4 so carrega depois que o visitante aceita. A escolha fica salva no navegador. */
(function(){
  var GA_ID='G-JXBJTRB23S';
  var KEY='bc_consent';
  window.dataLayer=window.dataLayer||[];
  function gtag(){dataLayer.push(arguments)}
  window.gtag=gtag;
  function get(){try{return localStorage.getItem(KEY)}catch(e){return null}}
  function set(v){try{localStorage.setItem(KEY,v)}catch(e){}}
  var loaded=false;
  function load(){
    if(loaded||!GA_ID)return;
    loaded=true;
    var s=document.createElement('script');s.async=true;
    s.src='https://www.googletagmanager.com/gtag/js?id='+GA_ID;
    document.head.appendChild(s);
    gtag('js',new Date());
    gtag('config',GA_ID,{anonymize_ip:true});
  }
  function banner(){
    var b=document.createElement('div');
    b.id='cookie-notice';
    b.setAttribute('role','dialog');b.setAttribute('aria-label','Aviso de cookies');
    b.innerHTML='<p>Usamos cookies de medição para entender como o site é usado e melhorar o atendimento. Saiba mais na <a href="/privacidade/">política de privacidade</a>.</p>'+
      '<div><button type="button" data-c="no">Recusar</button><button type="button" data-c="yes" class="ok">Aceitar</button></div>';
    b.addEventListener('click',function(e){
      var c=e.target&&e.target.getAttribute&&e.target.getAttribute('data-c');
      if(!c)return;
      set(c==='yes'?'granted':'denied');
      if(c==='yes')load();
      b.remove();
    });
    document.body.appendChild(b);
  }
  var st=get();
  if(st==='granted')load();
  else if(st!=='denied')banner();

  function track(name,p){try{p=p||{};p.page_path=location.pathname;gtag('event',name,p)}catch(e){}}
  document.addEventListener('click',function(e){
    var a=e.target.closest&&e.target.closest('a');
    if(!a)return;
    var h=a.getAttribute('href')||'',loc=a.id==='wa'?'botao_flutuante':(a.closest('section')&&a.closest('section').id)||'pagina';
    if(a.hasAttribute('data-wa')||/wa\.me|whatsapp:/.test(h)){track('whatsapp_click',{link_location:loc})}
    else if(/^mailto:/.test(h)){track('email_click',{link_location:loc})}
    else if(/instagram\.com|linkedin\.com/.test(h)){track('social_click',{link_url:h})}
    else if(a.getAttribute('data-ev')==='google_reviews_click'){track('google_reviews_click',{link_location:loc})}
  },true);
})();
