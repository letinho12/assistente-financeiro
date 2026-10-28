'use strict';

var CHAVE_CFG = 'af-config', CHAVE_DADOS = 'af-dados';
var MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
var MESES_LONGOS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
var brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
var brlCurto = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', maximumFractionDigits: 0 });

function $(id) { return document.getElementById(id); }
function ler(chave) { try { return JSON.parse(localStorage.getItem(chave)); } catch (e) { return null; } }
function gravar(chave, v) { try { localStorage.setItem(chave, JSON.stringify(v)); } catch (e) { /* modo privado */ } }
function el(tag, attrs, filhos) {
  var n = document.createElement(tag);
  Object.keys(attrs || {}).forEach(function (k) {
    if (k === 'texto') n.textContent = attrs[k]; else if (k === 'classe') n.className = attrs[k]; else n.setAttribute(k, attrs[k]);
  });
  (filhos || []).forEach(function (f) { if (f) n.appendChild(f); });
  return n;
}
function limpar(n) { while (n.firstChild) n.removeChild(n.firstChild); return n; }
function dataBR(iso) { if (!iso) return ''; var p = iso.slice(0, 10).split('-'); return p[2] + '/' + p[1]; }
function mesCurto(ym) { var p = ym.split('-'); return MESES[+p[1] - 1]; }
function mesComAno(ym) { var p = ym.split('-'); return MESES[+p[1] - 1] + '/' + p[0]; }
function limparDescricao(s) { return String(s || '').replace(/\s*\|\s*/g, ' · '); }

// ---------------------------------------------------------------- configuração

function lerConfigDoLink() {
  if (!location.hash) return;
  var p = new URLSearchParams(location.hash.slice(1));
  if (p.get('api') && p.get('token')) {
    gravar(CHAVE_CFG, { api: p.get('api'), token: p.get('token') });
    history.replaceState(null, '', location.pathname + location.search);
  }
}

function mostrarConfigurar(msg) {
  $('configurar').hidden = false;
  $('conteudo').hidden = true;
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
  carregar();
});

// ---------------------------------------------------------------- dados

function carregar() {
  var cfg = ler(CHAVE_CFG);
  if (!cfg) { mostrarConfigurar(); return; }
  var cache = ler(CHAVE_DADOS);
  if (cache) desenhar(cache, true);
  $('atualizar').classList.add('girando');
  fetch(cfg.api + '?token=' + encodeURIComponent(cfg.token), { redirect: 'follow' })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d.erro) { mostrarConfigurar('A planilha recusou o acesso. Gere o link de novo pelo script.'); return; }
      gravar(CHAVE_DADOS, d);
      desenhar(d, false);
    })
    .catch(function () {
      if (cache) $('sync').textContent += ' · sem conexão, mostrando os últimos dados';
      else mostrarConfigurar('Não consegui falar com a planilha. Verifique a conexão e a URL.');
    })
    .then(function () { $('atualizar').classList.remove('girando'); });
}

$('atualizar').addEventListener('click', carregar);

// ---------------------------------------------------------------- desenho

function desenhar(d, doCache) {
  $('configurar').hidden = true;
  $('conteudo').hidden = false;
  var r = d.resumo || {};
  var p = (d.mes || '').split('-');
  $('titulo-mes').textContent = p.length === 2 ? MESES_LONGOS[+p[1] - 1] + ' de ' + p[0] : 'Assistente Financeiro';
  $('sync').textContent = d.ultimaSync ? 'Atualizado em ' + dataBR(d.ultimaSync) + ' às ' + d.ultimaSync.slice(11, 16) : '';
  document.title = 'Finanças · ' + $('titulo-mes').textContent;

  desenharHeroi(r, d.alerta || 0.8);
  desenharTiles(r);
  desenharAnalise(d.analise);
  desenharCascata(r);
  desenharBarras($('g-categorias'), (d.categorias || []).filter(function (c) { return c.valor > 0; })
    .sort(function (a, b) { return b.valor - a.valor; })
    .map(function (c) { return { rotulo: c.categoria, valor: c.valor }; }), $('g-categorias-vazio'));
  desenharFaturas(d.faturas || []);
  desenharPatrimonio(d.investimentos || [], r['Patrimônio investido'] || 0, d.contas || []);
  desenharListas(d);
}

function desenharHeroi(r, alerta) {
  var restante = r['Ainda posso gastar'] || 0, pode = r['Quanto posso gastar no mês'] || 0;
  var usado = pode > 0 ? (r['Gasto variável até agora'] || 0) / pode : 1;
  $('h-restante').textContent = brl.format(restante);
  $('h-restante').classList.toggle('negativo', restante < 0);
  var st = restante < 0 ? ['Acima do limite', 'var(--critico)', '✕'] :
           usado >= alerta ? ['Atenção', 'var(--atencao)', '!'] : ['Dentro do limite', 'var(--bom)', '✓'];
  limpar($('h-status')).append(el('span', { classe: 'ponto', style: 'background:' + st[1] }), el('span', { texto: st[2] + ' ' + st[0] }));
  var pct = Math.max(0, Math.min(1, usado));
  $('h-medidor').style.width = (pct * 100).toFixed(1) + '%';
  $('h-medidor').style.background = st[1];
  $('h-medidor-rotulo').setAttribute('aria-label', Math.round(usado * 100) + '% do limite do mês já usado');
  var dias = r['Dias restantes no mês'] || 0;
  $('h-detalhe').textContent = pode > 0
    ? 'Já usou ' + Math.round(usado * 100) + '% de ' + brl.format(pode) + ' · ' + brl.format(r['Posso gastar por dia'] || 0) + ' por dia nos ' + dias + ' dias que faltam'
    : 'Os compromissos do mês já passam da renda: ' + brl.format(pode) + ' de limite.';
}

function desenharTiles(r) {
  var tiles = [
    ['Renda base', r['Renda mensal'], ''],
    ['Dinheiro extra', r['Dinheiro extra no mês'], 'acima do salário normal'],
    ['Fatura atual Nubank', r['Fatura atual (Nubank)'], ''],
    ['Próxima fatura', r['Próxima fatura já comprometida'], 'já comprometida'],
    ['Dívida parcelada', r['Dívida parcelada restante'], 'falta pagar'],
    ['Patrimônio', r['Patrimônio investido'], 'investido']
  ];
  var box = limpar($('tiles'));
  tiles.forEach(function (t) {
    if (t[1] === undefined) return;
    box.appendChild(el('div', { classe: 'tile' }, [
      el('p', { classe: 't-rot', texto: t[0] }), el('p', { classe: 't-val', texto: brl.format(t[1] || 0) }),
      t[2] ? el('p', { classe: 't-sub', texto: t[2] }) : null
    ]));
  });
}

function desenharAnalise(a) {
  $('analise').hidden = !a || !a.veredito;
  if (!a || !a.veredito) return;
  $('a-veredito').textContent = a.veredito;
  $('a-resumo').textContent = a.resumo || '';
  var ul = limpar($('a-dicas'));
  String(a.dicas || '').split(/\n+/).map(function (s) { return s.replace(/^[-•*\d.)\s]+/, '').trim(); })
    .filter(String).forEach(function (s) { ul.appendChild(el('li', { texto: s })); });
  $('a-data').textContent = a.geradaEm ? 'Gerada em ' + dataBR(a.geradaEm) + ' às ' + a.geradaEm.slice(11, 16) : '';
}

function desenharCascata(r) {
  var itens = [
    ['Renda base', r['Renda mensal']], ['− Mensalidades', r['(-) Mensalidades']], ['− Parcelas do mês', r['(-) Parcelados do mês']],
    ['− Compras fixas', r['(-) Compras fixas']], ['− Meta de investimento', r['(-) Meta de investimento']]
  ];
  var dl = limpar($('cascata'));
  itens.forEach(function (i) { dl.append(el('dt', { texto: i[0] }), el('dd', { texto: brl.format(i[1] || 0) })); });
  dl.append(el('dt', { classe: 'total', texto: '= Posso gastar no mês' }), el('dd', { classe: 'total', texto: brl.format(r['Quanto posso gastar no mês'] || 0) }));
}

function desenharBarras(box, dados, vazio) {
  limpar(box);
  if (vazio) vazio.hidden = dados.length > 0;
  var max = Math.max.apply(null, dados.map(function (x) { return x.valor; }).concat([1]));
  dados.forEach(function (x) {
    var barra = el('div', { classe: 'bh-barra', style: 'width:' + (x.valor / max * 72).toFixed(1) + '%' });
    var linha = el('div', { classe: 'bh' }, [
      el('span', { classe: 'bh-rot', texto: x.rotulo, title: x.rotulo }),
      el('div', { classe: 'bh-trilho' }, [barra, el('span', { classe: 'bh-val', texto: brl.format(x.valor) })])
    ]);
    box.appendChild(linha);
  });
}

function desenharFaturas(fat) {
  var box = limpar($('g-faturas'));
  var antigo = box.nextElementSibling;
  if (antigo && antigo.classList.contains('eixo-x')) antigo.remove();
  var max = Math.max.apply(null, fat.map(function (f) { return f.total; }).concat([1]));
  var eixo = el('div', { classe: 'eixo-x', 'aria-hidden': 'true' });
  fat.forEach(function (f, i) {
    var hP = f.parcelas / max * 100, hM = f.mensalidades / max * 100;
    var pilha = el('div', { classe: 'pilha', style: 'height:' + (hP + hM).toFixed(1) + '%' }, [
      f.parcelas > 0 ? el('div', { classe: 'seg s1' + (f.mensalidades > 0 ? '' : ' topo-seg'), style: 'flex:' + f.parcelas }) : null,
      f.mensalidades > 0 ? el('div', { classe: 'seg s2', style: 'flex:' + f.mensalidades }) : null
    ]);
    var col = el('div', { classe: 'col', tabindex: '0', 'aria-label': mesComAno(f.mes) + ': ' + brl.format(f.total) }, [pilha]);
    if (i === 0 || f.total === max) col.appendChild(el('span', { classe: 'val', texto: brlCurto.format(f.total) }));
    ligarDica(col, function () {
      return [mesComAno(f.mes), 'Total: ' + brl.format(f.total), 'Parcelas: ' + brl.format(f.parcelas) + ' (' + f.qtd + ')', 'Mensalidades: ' + brl.format(f.mensalidades)];
    });
    box.appendChild(col);
    eixo.appendChild(el('span', { texto: mesCurto(f.mes) }));
  });
  box.after(eixo);
  box.setAttribute('aria-label', 'Faturas dos próximos 12 meses; o detalhe está na tabela abaixo.');
  var t = limpar($('t-faturas'));
  t.appendChild(el('tr', {}, ['Mês', 'Parcelas', 'Mensalidades', 'Total'].map(function (h, i) { return el('th', { classe: i ? 'n' : '', texto: h }); })));
  fat.forEach(function (f) {
    t.appendChild(el('tr', {}, [mesComAno(f.mes), brl.format(f.parcelas), brl.format(f.mensalidades), brl.format(f.total)]
      .map(function (v, i) { return el('td', { classe: i ? 'n' : '', texto: v }); })));
  });
}

function desenharPatrimonio(invs, total, contas) {
  $('p-total').textContent = brl.format(total);
  var porTipo = {};
  invs.forEach(function (i) { porTipo[i.tipo || 'Outros'] = (porTipo[i.tipo || 'Outros'] || 0) + i.valor; });
  contas.forEach(function (c) { if (c.tipo === 'Conta investimento') porTipo['Saldo em corretora'] = (porTipo['Saldo em corretora'] || 0) + c.saldo; });
  desenharBarras($('g-patrimonio'), Object.keys(porTipo).map(function (k) { return { rotulo: k, valor: porTipo[k] }; })
    .filter(function (x) { return x.valor > 0; }).sort(function (a, b) { return b.valor - a.valor; }));
  var t = limpar($('t-invest'));
  t.appendChild(el('tr', {}, ['Aplicação', 'Onde', 'Valor'].map(function (h, i) { return el('th', { classe: i === 2 ? 'n' : '', texto: h }); })));
  invs.slice().sort(function (a, b) { return b.valor - a.valor; }).forEach(function (i) {
    var nome = (i.codigo ? i.codigo + ' · ' : '') + i.ativo + (i.taxa ? ' (' + i.taxa + ')' : '');
    t.appendChild(el('tr', {}, [el('td', { texto: nome }), el('td', { texto: i.instituicao }), el('td', { classe: 'n', texto: brl.format(i.valor) })]));
  });
}

function itemLista(tit, sub, val, classeVal) {
  return el('li', {}, [
    el('div', { classe: 'l-main' }, [el('div', { classe: 'l-tit', texto: tit, title: tit }), sub ? el('div', { classe: 'l-sub', texto: sub }) : null]),
    el('div', { classe: 'l-val' + (classeVal ? ' ' + classeVal : ''), texto: val })
  ]);
}

function desenharListas(d) {
  var l = limpar($('l-contas'));
  (d.contas || []).forEach(function (c) {
    if (c.tipo === 'Cartão de crédito' && !c.saldo && !(c.limite > 1)) return; // cartão sem uso (ex.: Itaú com limite R$ 1)
    l.appendChild(itemLista(c.conta, c.tipo + (c.limite ? ' · limite ' + brl.format(c.limite) : ''), brl.format(c.saldo)));
  });
  l = limpar($('l-parcelados'));
  (d.parcelados || []).sort(function (a, b) { return b.parcela - a.parcela; }).forEach(function (p) {
    l.appendChild(itemLista(p.descricao, 'Parcela ' + p.andamento + ' · faltam ' + brl.format(p.saldo), brl.format(p.parcela)));
  });
  if (!l.firstChild) l.appendChild(el('li', { classe: 'vazio', texto: 'Nenhum parcelamento ativo.' }));
  l = limpar($('l-mensalidades'));
  (d.mensalidades || []).sort(function (a, b) { return b.valor - a.valor; }).forEach(function (m) {
    l.appendChild(itemLista(m.nome, (m.dia ? 'Todo dia ' + m.dia + ' · ' : '') + m.conta, brl.format(m.valor)));
  });
  if (!l.firstChild) l.appendChild(el('li', { classe: 'vazio', texto: 'Nenhuma mensalidade cadastrada.' }));
  l = limpar($('l-transacoes'));
  (d.transacoes || []).forEach(function (t) {
    var entrada = t.tipo === 'Entrada';
    l.appendChild(itemLista(limparDescricao(t.descricao), dataBR(t.data) + ' · ' + t.conta + ' · ' + (t.classe === 'Variável' ? t.categoria : t.classe),
      (entrada ? '+ ' : '− ') + brl.format(t.valor), entrada ? 'entrada' : ''));
  });
}

// ---------------------------------------------------------------- dica ao passar o mouse / tocar

function ligarDica(alvo, conteudo) {
  var dica = $('dica');
  function mostrar(ev) {
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
  alvo.addEventListener('mouseleave', esconder);
  alvo.addEventListener('blur', esconder);
  alvo.addEventListener('touchstart', function () { mostrar(); setTimeout(esconder, 2500); }, { passive: true });
}

// ---------------------------------------------------------------- início

if ('serviceWorker' in navigator) {
  window.addEventListener('load', function () { navigator.serviceWorker.register('sw.js').catch(function () {}); });
}
lerConfigDoLink();
carregar();
