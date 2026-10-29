'use strict';

var CHAVE_CFG = 'af-config', CHAVE_DADOS = 'af-dados', CHAVE_PREF = 'af-pref';
var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
var MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
var SEMANA = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb'];
var ABAS = ['inicio', 'gastos', 'cartao', 'invest', 'mais'];
var brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
var brlCurto = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

var dados = null, online = true, filtro = 'Todas';
var pref = ler(CHAVE_PREF) || {};
var oculto = !!pref.ocultarAoAbrir;

function $(id) { return document.getElementById(id); }
function ler(chave) { try { return JSON.parse(localStorage.getItem(chave)); } catch (e) { return null; } }
function gravar(chave, v) { try { localStorage.setItem(chave, JSON.stringify(v)); } catch (e) { /* modo privado */ } }
function el(tag, attrs, filhos) {
  var n = document.createElement(tag);
  Object.keys(attrs || {}).forEach(function (k) {
    if (k === 'texto') n.textContent = attrs[k]; else if (k === 'classe') n.className = attrs[k]; else n.setAttribute(k, attrs[k]);
  });
  (filhos || []).forEach(function (f) { if (f) n.appendChild(typeof f === 'string' ? document.createTextNode(f) : f); });
  return n;
}
function limpar(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }

/** Valor em reais, ou bolinhas quando "ocultar valores" está ligado. */
function rs(v) { return oculto ? 'R$ ••••' : brl.format(v || 0); }
function rsCurto(v) { return oculto ? '••••' : brlCurto.format(v || 0); }

function dataLocal(iso) { var p = iso.slice(0, 10).split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
function hoje0() { var h = new Date(); return new Date(h.getFullYear(), h.getMonth(), h.getDate()); }
function dataCurta(iso) { var d = dataLocal(iso); return d.getDate() + ' ' + MESES[d.getMonth()]; }
function diaRelativo(iso) {
  var dias = Math.round((hoje0() - dataLocal(iso)) / 864e5);
  if (dias === 0) return 'Hoje';
  if (dias === 1) return 'Ontem';
  var d = dataLocal(iso);
  return SEMANA[d.getDay()].replace(/^./, function (c) { return c.toUpperCase(); }) + ', ' + d.getDate() + ' ' + MESES[d.getMonth()];
}
function haQuanto(isoHora) {
  var min = Math.round((Date.now() - new Date(isoHora)) / 6e4);
  if (min < 1) return 'agora';
  if (min < 60) return 'há ' + min + ' min';
  var h = Math.round(min / 60);
  if (h < 24) return 'há ' + h + ' h';
  var d = Math.round(h / 24);
  return 'há ' + d + (d === 1 ? ' dia' : ' dias');
}
function mesCurto(ym) { var p = ym.split('-'); return MESES[+p[1] - 1]; }
function mesComAno(ym) { var p = ym.split('-'); return MESES[+p[1] - 1] + '/' + p[0]; }

/** Nome do estabelecimento sem códigos do banco: "Mercadolivre*Mercadol 3/5" → "Mercadolivre Mercadol". */
function nomeLimpo(s) {
  var t = String(s || '').split('|').pop()
    .replace(/\b\d+\s*\/\s*\d+\s*$/, '')       // parcela "3/5"
    .replace(/\*/g, ' ').replace(/\b\d{4,}\b/g, '') // códigos longos
    .replace(/\s{2,}/g, ' ').trim();
  if (t === t.toUpperCase() && /[A-Z]{3}/.test(t)) {
    t = t.toLowerCase().replace(/(^|\s)\S/g, function (c) { return c.toUpperCase(); });
  }
  return t || String(s || '');
}

// ---------------------------------------------------------------- configuração

function lerConfigDoLink() {
  if (!/api=/.test(location.hash)) return;
  var p = new URLSearchParams(location.hash.slice(1));
  if (p.get('api') && p.get('token')) {
    gravar(CHAVE_CFG, { api: p.get('api'), token: p.get('token') });
    history.replaceState(null, '', location.pathname + location.search + '#/inicio');
  }
}

function mostrarConfigurar(msg) {
  $('configurar').hidden = false;
  $('conteudo').hidden = true;
  $('esqueleto').hidden = true;
  $('navegacao').hidden = true;
  $('sync').textContent = 'Não conectado';
  var cfg = ler(CHAVE_CFG) || {};
  $('cfg-api').value = cfg.api || '';
  $('cfg-token').value = cfg.token || '';
  $('cfg-erro').hidden = !msg;
  $('cfg-erro').textContent = msg || '';
}

$('cfg-salvar').addEventListener('click', function () {
  var api = $('cfg-api').value.trim(), token = $('cfg-token').value.trim();
  if (!/^https:\/\/script\.google\.com\/.+\/exec$/.test(api) || !token) {
    mostrarConfigurar('Confira a URL (precisa terminar em /exec) e o código de acesso.');
    return;
  }
  gravar(CHAVE_CFG, { api: api, token: token });
  $('configurar').hidden = true;
  carregar();
});

// ---------------------------------------------------------------- dados

function carregar() {
  var cfg = ler(CHAVE_CFG);
  if (!cfg) { mostrarConfigurar(); return; }
  var cache = ler(CHAVE_DADOS);
  if (cache) desenhar(cache); else $('esqueleto').hidden = false;
  $('atualizar').classList.add('girando');
  fetch(cfg.api + '?token=' + encodeURIComponent(cfg.token), { redirect: 'follow' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.erro) { mostrarConfigurar('A planilha recusou o acesso. Gere o link de novo pelo script (função gerarLinkDoApp).'); return; }
      online = true;
      gravar(CHAVE_DADOS, d);
      desenhar(d);
    })
    .catch(function () {
      online = false;
      if (cache) desenharConfianca(cache);
      else mostrarConfigurar('Não consegui falar com a planilha. Confira a internet e a URL; assim que der certo uma vez, o app passa a abrir mesmo offline.');
    })
    .then(function () { $('atualizar').classList.remove('girando'); });
}

$('atualizar').addEventListener('click', carregar);

// ---------------------------------------------------------------- navegação

function abaAtual() {
  var m = /^#\/(\w+)/.exec(location.hash);
  return m && ABAS.indexOf(m[1]) >= 0 ? m[1] : 'inicio';
}

function mostrarAba() {
  var aba = abaAtual();
  ABAS.forEach(function (a) {
    $('aba-' + a).hidden = a !== aba;
    var link = document.querySelector('.navegacao a[data-aba="' + a + '"]');
    if (a === aba) link.setAttribute('aria-current', 'page'); else link.removeAttribute('aria-current');
  });
  $('titulo').textContent = aba === 'inicio' && dados ? tituloMes(dados) : $('aba-' + aba).dataset.titulo;
  surgir($('aba-' + aba));
  window.scrollTo(0, 0);
}
window.addEventListener('hashchange', mostrarAba);

function irPara(aba) { location.hash = '#/' + aba; }

function tituloMes(d) {
  var p = (d.mes || '').split('-');
  return p.length === 2 ? MESES_LONGOS[+p[1] - 1] + ' de ' + p[0] : 'Início';
}

// ---------------------------------------------------------------- privacidade

function aplicarOcultar() {
  $('ocultar').setAttribute('aria-pressed', String(oculto));
  $('ocultar').setAttribute('aria-label', oculto ? 'Mostrar valores' : 'Ocultar valores');
  $('ocultar').title = oculto ? 'Mostrar valores' : 'Ocultar valores';
  $('olho').setAttribute('d', oculto
    ? 'M2 4.3 3.3 3l17.7 17.7-1.3 1.3-3.3-3.3A11 11 0 0 1 12 19C6.5 19 2.7 14.9 1.5 12a13 13 0 0 1 4.2-5.4zM12 5c5.5 0 9.3 4.1 10.5 7a13 13 0 0 1-3 4.3L16 12.8A4.5 4.5 0 0 0 11.2 8L8.7 5.5A11 11 0 0 1 12 5z'
    : 'M12 5C6.5 5 2.7 9.1 1.5 12c1.2 2.9 5 7 10.5 7s9.3-4.1 10.5-7C21.3 9.1 17.5 5 12 5zm0 11.5A4.5 4.5 0 1 1 12 7.5a4.5 4.5 0 0 1 0 9zm0-7a2.5 2.5 0 1 0 0 5 2.5 2.5 0 0 0 0-5z');
}
$('ocultar').addEventListener('click', function () {
  oculto = !oculto;
  aplicarOcultar();
  if (dados) desenhar(dados, true);
});
$('aj-ocultar').checked = !!pref.ocultarAoAbrir;
$('aj-ocultar').addEventListener('change', function () {
  pref.ocultarAoAbrir = this.checked;
  gravar(CHAVE_PREF, pref);
});
$('aj-reconectar').addEventListener('click', function () { mostrarConfigurar(); });

// ---------------------------------------------------------------- desenho

function desenhar(d, semAnimar) {
  dados = d;
  $('configurar').hidden = true;
  $('esqueleto').hidden = true;
  $('conteudo').hidden = false;
  $('navegacao').hidden = false;
  document.title = 'Finanças · ' + tituloMes(d);
  var r = d.resumo || {};
  semAnimacao = !!semAnimar;
  desenharConfianca(d);
  desenharHeroi(r, d.alerta || 0.8);
  desenharCascata(r);
  desenharPrioridades(d);
  desenharInsight(d);
  desenharTiles(r);
  desenharGastos(d);
  desenharCartao(d);
  desenharInvest(d);
  desenharMais(d);
  mostrarAba();
}

/** Selo de confiança: quando sincronizou, se está offline ou com dados antigos. */
function desenharConfianca(d) {
  var horas = d.ultimaSync ? (Date.now() - new Date(d.ultimaSync)) / 36e5 : 99;
  var antigo = horas > 30;
  $('sync').textContent = (online ? '' : 'Offline · ') + (d.ultimaSync ? 'Atualizado ' + haQuanto(d.ultimaSync) : 'Sem sincronização');
  $('selo-ponto').className = 'pulso' + (!online ? ' off' : antigo ? ' velho' : '');
  var aviso = $('aviso');
  if (!online) {
    aviso.textContent = 'Sem internet. Mostrando os dados da última vez que o app abriu.';
  } else if (antigo) {
    aviso.textContent = 'A planilha não sincroniza há mais de um dia. Os números podem estar atrasados; abra a planilha e use Assistente > Sincronizar agora.';
  }
  aviso.hidden = online && !antigo;
}

function desenharHeroi(r, alerta) {
  var restante = r['Ainda posso gastar'] || 0, pode = r['Quanto posso gastar no mês'] || 0;
  var gasto = r['Gasto variável até agora'] || 0;
  var usado = pode > 0 ? gasto / pode : 1;
  contar($('h-restante'), restante);
  $('h-restante').classList.toggle('negativo', restante < 0);
  $('h-restante').classList.toggle('positivo', restante >= 0);
  var st = restante < 0 ? ['Acima do limite', 'var(--critico)', '✕', 'rgba(248,113,113,0.22)'] :
           usado >= alerta ? ['Atenção', 'var(--atencao)', '!', 'rgba(251,191,36,0.2)'] : ['Dentro do limite', 'var(--bom)', '✓', 'rgba(34,211,238,0.22)'];
  document.documentElement.style.setProperty('--luz', st[3]); // a luz do fundo acompanha o status
  limpar($('h-status')).append(el('span', { classe: 'ponto', style: 'background:' + st[1] }), el('span', { texto: st[2] + ' ' + st[0] }));
  var pct = Math.max(0, Math.min(1, usado)), anel = $('h-anel');
  anel.style.stroke = st[1];
  anel.style.filter = 'drop-shadow(0 0 3px ' + st[1] + ')';
  anel.style.strokeDashoffset = semAnimacao ? String(100 - pct * 100) : '100';
  depois(function () { anel.style.strokeDashoffset = String(100 - pct * 100); });
  $('h-pct').textContent = pode > 0 ? Math.round(usado * 100) + '% do limite usado' : 'sem limite este mês';
  $('h-medidor-rotulo').setAttribute('aria-label', Math.round(usado * 100) + '% do limite do mês já usado');
  var dias = r['Dias restantes no mês'] || 0;
  $('h-detalhe').textContent = pode <= 0
    ? 'As contas fixas do mês já passam da renda base, então não sobra limite para gastos do dia a dia.'
    : restante < 0
      ? 'Você gastou ' + rs(gasto) + ' para um limite de ' + rs(pode) + '. Faltam ' + dias + ' dias no mês.'
      : 'Dá ' + rs(r['Posso gastar por dia']) + ' por dia nos ' + dias + ' dias que faltam. Já usou ' + Math.round(usado * 100) + '% do limite.';
}

function desenharCascata(r) {
  var itens = [
    ['Renda base', r['Renda mensal']], ['− Mensalidades', r['(-) Mensalidades']], ['− Parcelas do mês', r['(-) Parcelados do mês']],
    ['− Compras fixas', r['(-) Compras fixas']], ['− Meta de investimento', r['(-) Meta de investimento']]
  ];
  var dl = limpar($('cascata'));
  itens.forEach(function (i) { dl.append(el('dt', { texto: i[0] }), el('dd', { texto: rs(i[1]) })); });
  var pode = r['Quanto posso gastar no mês'] || 0;
  dl.append(el('dt', { classe: 'total', texto: '= Limite do mês' }), el('dd', { classe: 'total' + (pode < 0 ? ' negativo' : ''), texto: rs(pode) }));
}

/** "Pede atenção": uma lista só, ordenada por urgência (fatura perto de fechar, mensalidades da semana, parcelas do mês). */
function desenharPrioridades(d) {
  var r = d.resumo || {}, itens = [];
  var fecha = proximoFechamento(d.fechamento);
  if (r['Fatura atual (Nubank)'] != null) {
    itens.push({ urg: fecha ? fecha.dias : 30, aba: 'cartao', icone: 'cartao', tit: 'Fatura do Nubank',
      val: rs(r['Fatura atual (Nubank)']), sub: fecha ? 'Fecha ' + (fecha.dias === 0 ? 'hoje' : fecha.dias === 1 ? 'amanhã' : 'em ' + fecha.dias + ' dias') + ', ' + dataCurta(fecha.iso) : 'Em aberto' });
  }
  var semana = proximasMensalidades(d.mensalidades || [], 7);
  if (semana.length) {
    itens.push({ urg: semana[0].dias, aba: 'mais', icone: 'repete', tit: semana.length + (semana.length === 1 ? ' mensalidade' : ' mensalidades') + ' nos próximos 7 dias',
      val: rs(semana.reduce(function (s, m) { return s + m.valor; }, 0)), sub: semana.map(function (m) { return nomeLimpo(m.nome); }).slice(0, 3).join(', ') });
  }
  if (r['(-) Parcelados do mês'] > 0) {
    var n = (d.parcelados || []).length;
    itens.push({ urg: 20, aba: 'cartao', icone: 'parcela', tit: 'Parcelas deste mês', val: rs(r['(-) Parcelados do mês']),
      sub: n + (n === 1 ? ' compra parcelada' : ' compras parceladas') });
  }
  itens.sort(function (a, b) { return a.urg - b.urg; });
  var ul = limpar($('prioridades'));
  itens.forEach(function (i) {
    ul.appendChild(el('li', {}, [el('a', { href: '#/' + i.aba, classe: 'linha-link' }, [
      icone(i.icone),
      el('div', { classe: 'l-main' }, [el('div', { classe: 'l-tit', texto: i.tit }), el('div', { classe: 'l-sub', texto: i.sub })]),
      el('div', { classe: 'l-val', texto: i.val }),
      el('span', { classe: 'seta', 'aria-hidden': 'true', texto: '›' })
    ])]));
  });
  ul.closest('.secao').hidden = !itens.length;
}

var ICONES = {
  cartao: 'M3 6a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2v2H3zm0 4h18v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2zm3 5v2h5v-2z',
  repete: 'M7 7h10v3l4-4-4-4v3H5v6h2zm10 10H7v-3l-4 4 4 4v-3h12v-6h-2z',
  parcela: 'M4 5h16v3H4zm0 5.5h16v3H4zM4 16h10v3H4z'
};
function icone(nome) {
  var ns = 'http://www.w3.org/2000/svg', svg = document.createElementNS(ns, 'svg'), path = document.createElementNS(ns, 'path');
  svg.setAttribute('viewBox', '0 0 24 24'); svg.setAttribute('aria-hidden', 'true');
  path.setAttribute('d', ICONES[nome]); svg.appendChild(path);
  return el('span', { classe: 'avatar icone-' + nome }, [svg]);
}

function proximoFechamento(dia) {
  if (!dia) return null;
  var h = hoje0(), f = new Date(h.getFullYear(), h.getMonth(), dia);
  if (f < h) f = new Date(h.getFullYear(), h.getMonth() + 1, dia);
  var iso = f.getFullYear() + '-' + String(f.getMonth() + 1).padStart(2, '0') + '-' + String(f.getDate()).padStart(2, '0');
  return { dias: Math.round((f - h) / 864e5), iso: iso };
}

function proximasMensalidades(lista, janela) {
  var h = hoje0();
  return lista.map(function (m) {
    var dia = +m.dia || 1, prox = new Date(h.getFullYear(), h.getMonth(), dia);
    if (prox < h) prox = new Date(h.getFullYear(), h.getMonth() + 1, dia);
    return { nome: m.nome, valor: m.valor, dias: Math.round((prox - h) / 864e5), data: prox };
  }).filter(function (m) { return m.dias <= janela; }).sort(function (a, b) { return a.dias - b.dias; });
}

/** Um insight por vez: a análise do assistente quando existir; senão, o maior gasto do mês. */
function desenharInsight(d) {
  var a = d.analise, box = $('insight'), acao = $('insight-acao');
  limpar($('insight-dicas'));
  acao.hidden = true;
  if (a && a.veredito) {
    $('insight-rotulo').textContent = 'Análise do assistente';
    $('insight-titulo').textContent = a.veredito;
    $('insight-texto').textContent = a.resumo || '';
    String(a.dicas || '').split(/\n+/).map(function (s) { return s.replace(/^[-•*\d.)\s]+/, '').trim(); })
      .filter(String).slice(0, 3).forEach(function (s) { $('insight-dicas').appendChild(el('li', { texto: s })); });
    $('insight-data').textContent = a.geradaEm ? 'Gerada ' + haQuanto(a.geradaEm) : '';
    box.hidden = false;
    return;
  }
  var cats = (d.categorias || []).filter(function (c) { return c.valor > 0 && c.categoria !== 'Outros'; })
    .sort(function (x, y) { return y.valor - x.valor; });
  if (!cats.length) { box.hidden = true; return; }
  var total = (d.categorias || []).reduce(function (s, c) { return s + (c.valor > 0 ? c.valor : 0); }, 0);
  var c = cats[0];
  $('insight-rotulo').textContent = 'Para onde foi o dinheiro';
  $('insight-titulo').textContent = c.categoria + ' é o seu maior gasto do mês';
  $('insight-texto').textContent = rs(c.valor) + (total ? ', ' + Math.round(c.valor / total * 100) + '% de tudo que você gastou no dia a dia.' : '.');
  $('insight-data').textContent = '';
  acao.textContent = 'Ver gastos com ' + c.categoria.toLowerCase();
  acao.onclick = function () { filtro = c.categoria; desenharTransacoes(dados); irPara('gastos'); };
  acao.hidden = false;
  box.hidden = false;
}

function desenharTiles(r) {
  var stats = [
    ['Renda base', r['Renda mensal'], 'salário normal', ''],
    ['Dinheiro extra', r['Dinheiro extra no mês'], 'acima do salário', ''],
    ['Dívida parcelada', r['Dívida parcelada restante'], 'falta pagar', 'cartao'],
    ['Patrimônio', r['Patrimônio investido'], 'investido', 'invest']
  ];
  var box = limpar($('tiles'));
  stats.forEach(function (t) {
    if (t[1] === undefined) return;
    var filhos = [el('p', { classe: 't-rot', texto: t[0] }), el('p', { classe: 't-val', texto: rs(t[1]) }), el('p', { classe: 't-sub', texto: t[2] })];
    box.appendChild(t[3] ? el('a', { classe: 'stat', href: '#/' + t[3] }, filhos) : el('div', { classe: 'stat' }, filhos));
  });
}

// ---------------------------------------------------------------- Gastos

/**
 * Para onde foi o dinheiro: uma faixa de parte-do-todo com a maior categoria em destaque (ênfase)
 * e as demais em cinza, seguida do ranking em texto. Tocar numa categoria filtra as transações.
 */
function desenharGastos(d) {
  var cats = (d.categorias || []).filter(function (c) { return c.valor > 0; }).sort(function (a, b) { return b.valor - a.valor; });
  var total = cats.reduce(function (s, c) { return s + c.valor; }, 0);
  $('g-total').textContent = rs((d.resumo || {})['Gasto variável até agora']);
  $('g-categorias-vazio').hidden = cats.length > 0;
  var foco = cats.filter(function (c) { return c.categoria !== 'Outros'; })[0];
  var cinzas = ['#5b6170', '#4a4f5c', '#3d414c'];
  var cor = function (c, i) { return foco && c === foco ? 'var(--acento)' : cinzas[i % cinzas.length]; };
  desenharFaixa($('g-faixa'), cats.map(function (c, i) { return { rotulo: c.categoria, valor: c.valor, cor: cor(c, i) }; }), total,
    'Gasto por categoria; o ranking está logo abaixo.');
  var ol = limpar($('g-categorias'));
  cats.forEach(function (c, i) {
    var b = el('button', { type: 'button', classe: 'rank' + (foco && c === foco ? ' foco' : ''), 'aria-label': 'Ver transações de ' + c.categoria }, [
      el('i', { classe: 'pinta', style: 'background:' + cor(c, i) }),
      el('span', { classe: 'r-nome', texto: c.categoria }),
      el('span', { classe: 'r-pct', texto: total ? Math.round(c.valor / total * 100) + '%' : '' }),
      el('span', { classe: 'r-val', texto: rs(c.valor) })
    ]);
    b.addEventListener('click', function () { filtro = c.categoria; desenharTransacoes(dados); $('filtros').scrollIntoView({ behavior: 'smooth' }); });
    ol.appendChild(el('li', {}, [b]));
  });
  desenharTransacoes(d);
}

/** Faixa horizontal de parte-do-todo, com 2px de vão entre os pedaços. */
function desenharFaixa(box, partes, total, rotulo) {
  limpar(box).setAttribute('aria-label', rotulo);
  partes.forEach(function (p) {
    var seg = el('span', { classe: 'faixa-seg', style: 'background:' + p.cor + ';flex-grow:' + (semAnimacao ? p.valor : 0.0001) });
    ligarDica(seg, function () { return [p.rotulo, rs(p.valor) + (total ? ' · ' + Math.round(p.valor / total * 100) + '%' : '')]; });
    box.appendChild(seg);
    depois(function () { seg.style.flexGrow = p.valor; });
  });
}

function contaComoGasto(t) { return t.tipo === 'Saída' && (t.classe === 'Variável' || t.classe === 'Parcela' || t.classe === 'Mensalidade'); }

function desenharTransacoes(d) {
  var todas = d.transacoes || [];
  var cats = {};
  todas.forEach(function (t) { if (contaComoGasto(t) && t.classe === 'Variável') cats[t.categoria] = (cats[t.categoria] || 0) + t.valor; });
  var opcoes = ['Todas', 'Entradas', 'Pendentes'].concat(Object.keys(cats).sort(function (a, b) { return cats[b] - cats[a]; }));
  if (opcoes.indexOf(filtro) < 0) filtro = 'Todas';
  var chips = limpar($('filtros'));
  opcoes.forEach(function (o) {
    var b = el('button', { type: 'button', classe: 'chip-filtro', 'aria-pressed': String(o === filtro), texto: o });
    b.addEventListener('click', function () { filtro = o; desenharTransacoes(dados); });
    chips.appendChild(b);
  });
  var lista = todas.filter(function (t) {
    if (filtro === 'Todas') return true;
    if (filtro === 'Entradas') return t.tipo === 'Entrada';
    if (filtro === 'Pendentes') return t.pendente;
    return t.categoria === filtro && contaComoGasto(t);
  });
  var box = limpar($('l-transacoes'));
  if (!lista.length) {
    box.appendChild(el('p', { classe: 'vazio', texto: 'Nada por aqui com esse filtro.' }));
    return;
  }
  var dia = '', ul = null;
  lista.forEach(function (t) {
    if (t.data !== dia) {
      dia = t.data;
      box.appendChild(el('h3', { classe: 'dia', texto: diaRelativo(t.data) }));
      ul = box.appendChild(el('ul', { classe: 'lista' }));
    }
    var entrada = t.tipo === 'Entrada', neutra = !entrada && !contaComoGasto(t);
    var selos = [];
    if (t.pendente) selos.push(el('span', { classe: 'selo-mini', texto: 'pendente' }));
    if (neutra) selos.push(el('span', { classe: 'selo-mini', texto: 'não conta como gasto' }));
    var sub = t.conta + ' · ' + (t.classe === 'Variável' ? t.categoria : t.classe);
    var li = itemLista(nomeLimpo(t.descricao), sub, (entrada ? '+ ' : '− ') + rs(t.valor), entrada ? 'entrada' : '', null, selos);
    li.insertBefore(el('span', { classe: 'avatar' + (entrada ? ' entrada' : ''), 'aria-hidden': 'true',
      texto: entrada ? '+' : (t.classe === 'Variável' ? t.categoria : t.classe).slice(0, 1).toUpperCase() }), li.firstChild);
    li.title = t.descricao;
    if (t.pendente || neutra) li.classList.add('esmaecida');
    ul.appendChild(li);
  });
}

// ---------------------------------------------------------------- Cartão

function desenharCartao(d) {
  var r = d.resumo || {};
  var cartao = (d.contas || []).filter(function (c) { return /nubank/i.test(c.conta) && c.tipo === 'Cartão de crédito'; })[0] || {};
  $('c-fatura').textContent = rs(r['Fatura atual (Nubank)']);
  var fecha = proximoFechamento(d.fechamento);
  $('c-fecha').textContent = fecha ? 'Fecha ' + (fecha.dias === 0 ? 'hoje' : 'em ' + fecha.dias + (fecha.dias === 1 ? ' dia' : ' dias')) + ', no dia ' + dataCurta(fecha.iso) + '.' : 'Fatura em aberto.';
  var usado = cartao.usado || 0, limite = cartao.limite || 0;
  $('c-limite').textContent = limite ? rs(usado) + ' do limite de ' + rs(limite) + ' já usado, contando as parcelas futuras.' : '';
  depois(function () { $('c-limite-barra').style.width = limite ? Math.min(100, usado / limite * 100).toFixed(1) + '%' : '0'; });
  desenharFaturas(d.faturas || []);
  var l = limpar($('l-parcelados'));
  var ps = (d.parcelados || []).slice().sort(function (a, b) { return b.parcela - a.parcela; });
  var restante = ps.reduce(function (s, p) { return s + p.saldo; }, 0);
  $('p-resumo').textContent = ps.length ? ps.length + ' compras · ' + rs(restante) + ' ainda a pagar' : '';
  ps.forEach(function (p) {
    var m = /(\d+)\D+(\d+)/.exec(String(p.andamento)); // "4 de 12"
    l.appendChild(itemLista(nomeLimpo(p.descricao), 'Parcela ' + p.andamento + ' · faltam ' + rs(p.saldo), rs(p.parcela), '', m ? +m[1] / +m[2] : null));
  });
  if (!ps.length) l.appendChild(el('li', { classe: 'vazio', texto: 'Nenhuma compra parcelada no momento. Quando você parcelar algo no cartão, ela aparece aqui com o quanto falta.' }));
}

function desenharFaturas(fat) {
  var box = limpar($('g-faturas'));
  var antigo = box.nextElementSibling;
  if (antigo && antigo.classList.contains('eixo-x')) antigo.remove();
  var max = Math.max.apply(null, fat.map(function (f) { return f.total; }).concat([1]));
  var eixo = el('div', { classe: 'eixo-x', 'aria-hidden': 'true' });
  fat.forEach(function (f, i) {
    var hP = f.parcelas / max * 100, hM = f.mensalidades / max * 100;
    var pilha = el('div', { classe: 'pilha', style: 'height:' + (hP + hM).toFixed(1) + '%;transform:scaleY(' + (semAnimacao ? 1 : 0) + ');transition-delay:' + (i * 40) + 'ms' }, [
      f.parcelas > 0 ? el('div', { classe: 'seg s1' + (f.mensalidades > 0 ? '' : ' topo-seg'), style: 'flex:' + f.parcelas }) : null,
      f.mensalidades > 0 ? el('div', { classe: 'seg s2', style: 'flex:' + f.mensalidades }) : null
    ]);
    var col = el('button', { type: 'button', classe: 'col', 'aria-label': mesComAno(f.mes) + ': ' + rs(f.total) }, [pilha]);
    if (i === 0) col.appendChild(el('span', { classe: 'val', texto: rsCurto(f.total) })); // só o mês atual: no celular os rótulos se sobrepõem
    ligarDica(col, function () {
      return [mesComAno(f.mes), 'Total: ' + rs(f.total), 'Parcelas: ' + rs(f.parcelas) + ' (' + f.qtd + ')', 'Mensalidades: ' + rs(f.mensalidades)];
    });
    box.appendChild(col);
    eixo.appendChild(el('span', { texto: mesCurto(f.mes) }));
  });
  box.after(eixo);
  box.setAttribute('aria-label', 'Faturas dos próximos 12 meses com o que já está comprometido.');
  depois(function () { box.querySelectorAll('.pilha').forEach(function (p) { p.style.transform = 'scaleY(1)'; }); });
}

// ---------------------------------------------------------------- Investimentos

function desenharInvest(d) {
  var invs = d.investimentos || [], contas = d.contas || [];
  var total = (d.resumo || {})['Patrimônio investido'] || 0;
  $('p-total').textContent = rs(total);
  var datas = invs.map(function (i) { return i.atualizado; }).filter(Boolean).sort();
  $('p-atualizado').textContent = datas.length ? 'Posições atualizadas em ' + dataCurta(datas[datas.length - 1]) + '. Valores de mercado mudam ao longo do dia.' : '';
  // Até 3 grupos com cor (paleta validada para fundo escuro) e o resto em "Outros".
  var grupo = function (tipo) {
    if (/renda fixa|tesouro|previd/i.test(tipo)) return 'Renda fixa';
    if (/a[çc][õo]es|etf|fii|cripto|coe/i.test(tipo)) return 'Renda variável';
    return 'Outros';
  };
  var porGrupo = { 'Renda fixa': 0, 'Saldo na corretora': 0, 'Renda variável': 0, 'Outros': 0 };
  invs.forEach(function (i) { porGrupo[grupo(i.tipo || '')] += i.valor; });
  contas.forEach(function (c) { if (c.tipo === 'Conta investimento') porGrupo['Saldo na corretora'] += c.saldo; });
  var cores = { 'Renda fixa': '#0ea5c4', 'Saldo na corretora': '#9085e9', 'Renda variável': '#d55181', 'Outros': '#5b6170' };
  var partes = Object.keys(porGrupo).filter(function (k) { return porGrupo[k] > 0; })
    .map(function (k) { return { rotulo: k, valor: porGrupo[k], cor: cores[k] }; });
  var soma = partes.reduce(function (s, p) { return s + p.valor; }, 0);
  desenharFaixa($('p-faixa'), partes, soma, 'Patrimônio por tipo; os valores estão na legenda.');
  var leg = limpar($('g-patrimonio'));
  partes.forEach(function (p) {
    leg.appendChild(el('li', {}, [el('i', { classe: 'pinta', style: 'background:' + p.cor }), el('span', { classe: 'r-nome', texto: p.rotulo }),
      el('span', { classe: 'r-pct', texto: soma ? Math.round(p.valor / soma * 100) + '%' : '' }), el('span', { classe: 'r-val', texto: rs(p.valor) })]));
  });
  var l = limpar($('l-invest'));
  invs.slice().sort(function (a, b) { return b.valor - a.valor; }).forEach(function (i) {
    var nome = i.codigo ? i.codigo : nomeLimpo(i.ativo).replace(/ - .*/, '');
    var sub = [i.instituicao, i.taxa, i.vencimento ? 'vence ' + dataCurta(i.vencimento) : ''].filter(Boolean).join(' · ');
    var li = itemLista(nome, sub, rs(i.valor));
    li.insertBefore(el('span', { classe: 'avatar', style: 'color:' + cores[grupo(i.tipo || '')], texto: (i.codigo || i.instituicao || '?').slice(0, 2).toUpperCase() }), li.firstChild);
    l.appendChild(li);
  });
  if (!invs.length) l.appendChild(el('li', { classe: 'vazio', texto: 'Nenhuma aplicação chegou pela Pluggy ainda. Elas aparecem aqui depois da próxima sincronização.' }));
}

// ---------------------------------------------------------------- Mais

function desenharMais(d) {
  var ms = (d.mensalidades || []).slice();
  var proximas = proximasMensalidades(ms, 31);
  $('m-total').textContent = rs(ms.reduce(function (s, m) { return s + m.valor; }, 0)) + ' por mês';
  var l = limpar($('l-mensalidades'));
  proximas.forEach(function (m) {
    var quando = m.dias === 0 ? 'Cobra hoje' : m.dias === 1 ? 'Cobra amanhã' : 'Próxima cobrança ' + m.data.getDate() + ' ' + MESES[m.data.getMonth()];
    var li = itemLista(nomeLimpo(m.nome), quando, rs(m.valor));
    li.insertBefore(el('span', { classe: 'avatar dia-chip', 'aria-hidden': 'true' }, [el('b', { texto: String(m.data.getDate()) }), el('small', { texto: MESES[m.data.getMonth()] })]), li.firstChild);
    l.appendChild(li);
  });
  if (!ms.length) l.appendChild(el('li', { classe: 'vazio', texto: 'Nenhuma assinatura detectada. O app encontra sozinho as cobranças que se repetem todo mês.' }));
  l = limpar($('l-contas'));
  (d.contas || []).forEach(function (c) {
    if (c.tipo === 'Cartão de crédito' && !c.saldo && !(c.limite > 1)) return; // cartão sem uso (ex.: Itaú com limite R$ 1)
    var sub = c.tipo.replace(' (já nas posições)', '') + (c.atualizado ? ' · atualizada em ' + dataCurta(c.atualizado) : '');
    l.appendChild(itemLista(c.conta, sub, rs(c.saldo)));
  });
}

// ---------------------------------------------------------------- componentes

function itemLista(tit, sub, val, classeVal, progresso, selos) {
  var barra = null;
  if (progresso != null) {
    barra = el('div', { classe: 'progresso', 'aria-hidden': 'true' }, [el('i', { style: 'width:' + Math.round(progresso * 100) + '%' })]);
  }
  return el('li', {}, [
    el('div', { classe: 'l-main' }, [
      el('div', { classe: 'l-tit', texto: tit }),
      sub ? el('div', { classe: 'l-sub' }, [sub].concat(selos || [])) : null,
      barra
    ]),
    el('div', { classe: 'l-val' + (classeVal ? ' ' + classeVal : ''), texto: val })
  ]);
}

// ---------------------------------------------------------------- movimento

var semMovimento = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;
var semAnimacao = false;

/** Roda depois do próximo quadro, para as transições de largura/altura partirem do zero. */
function depois(fn) { requestAnimationFrame(function () { requestAnimationFrame(fn); }); }

/** Contador animado até o valor final. */
function contar(alvo, valor) {
  if (oculto) { alvo.textContent = rs(valor); return; }
  if (semMovimento || semAnimacao || alvo.dataset.valor === String(valor)) { alvo.textContent = brl.format(valor); alvo.dataset.valor = valor; return; }
  alvo.dataset.valor = valor;
  var ini = performance.now(), dur = 900;
  (function passo(t) {
    var k = Math.min(1, (t - ini) / dur), e = 1 - Math.pow(1 - k, 3);
    alvo.textContent = brl.format(valor * e);
    if (k < 1) requestAnimationFrame(passo);
  })(ini);
}

/** Entrada dos cartões com fade + blur, um depois do outro, na primeira vez que a aba aparece. */
function surgir(aba) {
  Array.prototype.forEach.call(aba.children, function (n, i) {
    if (n.dataset.surgiu) return;
    n.dataset.surgiu = '1';
    n.style.animationDelay = (i * 60) + 'ms';
    n.classList.add('surgir');
  });
}

/** Brilho que segue o cursor dentro do cartão. */
document.addEventListener('pointermove', function (ev) {
  var c = ev.target.closest && ev.target.closest('.insight, .grupo');
  if (!c) return;
  var r = c.getBoundingClientRect();
  c.style.setProperty('--x', (ev.clientX - r.left) + 'px');
  c.style.setProperty('--y', (ev.clientY - r.top) + 'px');
}, { passive: true });

// ---------------------------------------------------------------- dica ao tocar / passar o mouse

function ligarDica(alvo, conteudo) {
  var dica = $('dica');
  function mostrar() {
    var linhas = conteudo();
    limpar(dica).appendChild(el('b', { texto: linhas[0] }));
    linhas.slice(1).forEach(function (s) { dica.appendChild(el('div', { texto: s })); });
    dica.hidden = false;
    var r = alvo.getBoundingClientRect();
    var x = Math.min(window.innerWidth - dica.offsetWidth - 8, Math.max(8, r.left + r.width / 2 - dica.offsetWidth / 2));
    dica.style.left = x + 'px';
    dica.style.top = Math.max(8, r.top - dica.offsetHeight - 8) + 'px';
  }
  function esconder() { dica.hidden = true; }
  alvo.addEventListener('mouseenter', mostrar);
  alvo.addEventListener('focus', mostrar);
  alvo.addEventListener('click', mostrar);
  alvo.addEventListener('mouseleave', esconder);
  alvo.addEventListener('blur', esconder);
}
window.addEventListener('scroll', function () { $('dica').hidden = true; }, { passive: true });

// ---------------------------------------------------------------- início

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
}
aplicarOcultar();
lerConfigDoLink();
carregar();
