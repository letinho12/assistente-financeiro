/**
 * Assistente Financeiro - Etapa 2: alimentação automática da planilha.
 *
 * Lê da Pluggy (Open Finance) as contas, transações, parcelas e investimentos
 * do Nubank, Itaú e BTG, e o saldo de Bitcoin pela blockchain.
 *
 * Instalação: preencha os valores dentro de configurar() logo abaixo, escolha
 * "configurar" no topo do editor e clique em Executar. Depois pode apagar os valores:
 * eles ficam guardados nas Propriedades do script.
 */

function configurar() {
  var chaves = {
    PLUGGY_CLIENT_ID: '',      // Client ID da sua aplicação na Pluggy
    PLUGGY_CLIENT_SECRET: '',  // Client Secret da sua aplicação na Pluggy
    PLUGGY_ITEM_IDS: '',       // os 3 Item IDs, separados por vírgula
    BTC_XPUB: '',              // opcional: xpub da BlueWallet (só leitura)
    BTC_ADDRESSES: ''          // opcional: endereços BTC separados por vírgula, se não usar xpub
  };
  var props = PropertiesService.getScriptProperties();
  Object.keys(chaves).forEach(function (k) {
    if (chaves[k]) props.setProperty(k, chaves[k].trim());
  });
  if (!props.getProperty('PLUGGY_CLIENT_ID') || !props.getProperty('PLUGGY_CLIENT_SECRET') || !props.getProperty('PLUGGY_ITEM_IDS')) {
    throw new Error('Faltou preencher PLUGGY_CLIENT_ID, PLUGGY_CLIENT_SECRET ou PLUGGY_ITEM_IDS dentro de configurar().');
  }
  SpreadsheetApp.getActive().setSpreadsheetTimeZone('America/Sao_Paulo');
  instalarGatilhoDiario();
  sincronizar();
}

var PLUGGY = 'https://api.pluggy.ai';
var DIAS_PRIMEIRA_SYNC = 90;
var DIAS_SYNC_DIARIA = 15;
var DIAS_PARCELAS = 400; // janela do cartão usada para montar os parcelamentos

var ABA = {
  transacoes: 'Transações', mensalidades: 'Mensalidades', parcelados: 'Parcelados',
  contas: 'Contas', investimentos: 'Investimentos', config: 'Config'
};

// ---------------------------------------------------------------- menu e gatilho

function onOpen() {
  SpreadsheetApp.getUi().createMenu('Assistente')
    .addItem('Sincronizar agora', 'sincronizar')
    .addItem('Ativar sincronização diária', 'instalarGatilhoDiario')
    .addToUi();
}

function instalarGatilhoDiario() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sincronizar') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('sincronizar').timeBased().everyDays(1).atHour(6).create();
  avisar('Sincronização diária ativada (todo dia por volta das 6h).');
}

// ---------------------------------------------------------------- sincronização

function sincronizar() {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.getActive();
  prepararAbas(ss);
  var resumo = [];

  if (props.getProperty('PLUGGY_CLIENT_ID')) {
    var ultima = props.getProperty('ULTIMA_SYNC');
    var dias = ultima ? DIAS_SYNC_DIARIA : DIAS_PRIMEIRA_SYNC;
    var de = Utilities.formatDate(new Date(Date.now() - dias * 864e5), 'UTC', 'yyyy-MM-dd');
    var apiKey = pluggyAuth(props);
    var itens = (props.getProperty('PLUGGY_ITEM_IDS') || '').split(',').map(trim).filter(String);
    var mensalidades = lerMensalidades(ss);
    var titular = nomeDoTitular(ss, apiKey, itens);

    var deParcelas = Utilities.formatDate(new Date(Date.now() - DIAS_PARCELAS * 864e5), 'UTC', 'yyyy-MM-dd');
    var cartoes = [], investimentos = [], vistas = {};

    itens.forEach(function (itemId) {
      // Pelo Meu Pluggy toda conexão se chama "MeuPluggy". O banco vem do nome das contas,
      // e vale para todas as contas da mesma conexão (o cartão do Nubank se chama "croma-platinum").
      var contas = pluggyGet(apiKey, '/accounts?itemId=' + itemId).results || [];
      var bancoDoItem = contas.map(banco).filter(String)[0] || '';
      contas.forEach(function (conta) {
        var nome = nomeConta(conta, bancoDoItem);
        var antigo = nomeConta(conta, '');
        if (antigo !== nome) renomearConta(ss, antigo, nome);
        atualizarConta(ss, nome, conta);
        vistas[nome] = true;
        var txs = pluggyTransacoes(apiKey, conta.id, conta.type === 'CREDIT' ? deParcelas : de);
        // Compras da fatura aberta chegam como pendentes: entram sempre, e são regravadas a cada sincronização.
        var n = gravarTransacoes(ss, txs.filter(function (t) { return String(t.date).slice(0, 10) >= de || t.status === 'PENDING'; }),
                                 nome, conta.type, mensalidades, titular);
        var pend = txs.filter(function (t) { return t.status === 'PENDING'; }).length;
        resumo.push(nome + ': ' + n + ' transações novas' + (pend ? ' (' + pend + ' pendentes)' : ''));
        if (conta.type === 'CREDIT') {
          cartoes.push({ conta: nome, txs: txs });
          var fatura = faturaAberta(txs, diaDeFechamento(ss, conta), new Date(), ultimaFatura(apiKey, conta.id),
                                    parceladosIgnorados());
          if (fatura) {
            gravarFatura(ss, nome, fatura.valor);
            resumo.push(nome + ': fatura aberta R$ ' + fatura.valor.toFixed(2) + ' (fatura anterior ' +
                        (fatura.anterior == null ? '?' : fatura.anterior.toFixed(2)) + ', compras ' + fatura.compras.toFixed(2) +
                        ', pagamentos e estornos ' + fatura.creditos.toFixed(2) + ')');
          }
        }
      });
      try {
        var inst = bancoDoItem ? bancoDoItem + ' (investimentos)' : 'Outros (investimentos)';
        pluggyTodas(apiKey, '/investments?itemId=' + itemId + '&pageSize=500').forEach(function (inv) {
          investimentos.push({ inv: inv, inst: inst });
        });
      } catch (e) {
        resumo.push('Investimentos: ' + e.message);
      }
    });

    removerParcelasFuturas(ss);
    reconstruirParcelados(ss, cartoes);
    reconstruirInvestimentos(ss, investimentos);
    evitarPatrimonioDuplicado(ss, investimentos);
    limparContasAntigas(ss, vistas);
    reclassificarBTG(ss);
    removerDuplicadasBTG(ss);
    pixPagoComCartao(ss);
    migrarPixParaTerceiros(ss, titular);
    resumo.push(investimentos.length + ' investimentos lidos');
    var novas = detectarRecorrentes(ss);
    if (novas) resumo.push(novas + ' mensalidade(s) detectada(s) para revisar');
    var renda = atualizarRenda(ss);
    if (renda) resumo.push(renda);
    props.setProperty('ULTIMA_SYNC', new Date().toISOString());
  }

  try {
    var btc = sincronizarBitcoin(props, ss);
    if (btc) resumo.push(btc);
  } catch (e) {
    resumo.push('Bitcoin: ' + e.message);
  }

  atualizarTotaisDoMes(ss);
  marcarUltimaSync(ss);
  Logger.log(resumo.join('\n'));
  avisar(resumo.join('\n') || 'Nada configurado ainda. Veja as Propriedades do script.');
}

/** Mostra no registro de execução o que a Pluggy entrega de cada conexão (contas e investimentos). */
function diagnostico() {
  var props = PropertiesService.getScriptProperties();
  var apiKey = pluggyAuth(props);
  (props.getProperty('PLUGGY_ITEM_IDS') || '').split(',').map(trim).filter(String).forEach(function (itemId) {
    var item = pluggyGet(apiKey, '/items/' + itemId);
    Logger.log('Conexão ' + itemId + ' | status: ' + item.status + ' | atualizada: ' + item.lastUpdatedAt +
               ' | produtos: ' + JSON.stringify(item.products || ''));
    (pluggyGet(apiKey, '/accounts?itemId=' + itemId).results || []).forEach(function (c) {
      Logger.log('  Conta: ' + c.name + ' | tipo: ' + c.type + '/' + c.subtype + ' | saldo: ' + c.balance);
    });
    try {
      var invs = pluggyTodas(apiKey, '/investments?itemId=' + itemId + '&pageSize=500');
      Logger.log('  Investimentos: ' + invs.length);
      invs.forEach(function (i) {
        Logger.log('    ' + i.name + ' | ' + i.type + '/' + i.subtype + ' | código: ' + (i.code || '') +
                   ' | qtd: ' + i.quantity + ' | saldo: ' + i.balance + ' | status: ' + (i.status || ''));
      });
    } catch (e) {
      Logger.log('  Investimentos: erro ' + e.message);
    }
  });
}

// ---------------------------------------------------------------- Pluggy

function pluggyAuth(props) {
  var r = UrlFetchApp.fetch(PLUGGY + '/auth', {
    method: 'post', contentType: 'application/json', muteHttpExceptions: true,
    payload: JSON.stringify({
      clientId: props.getProperty('PLUGGY_CLIENT_ID'),
      clientSecret: props.getProperty('PLUGGY_CLIENT_SECRET')
    })
  });
  if (r.getResponseCode() !== 200) throw new Error('Pluggy recusou as chaves: ' + r.getContentText());
  return JSON.parse(r.getContentText()).apiKey;
}

function pluggyGet(apiKey, caminho) {
  var r = UrlFetchApp.fetch(PLUGGY + caminho, { headers: { 'X-API-KEY': apiKey }, muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('Pluggy ' + caminho + ': ' + r.getContentText());
  return JSON.parse(r.getContentText());
}

/** Transações usam paginação por cursor: cada página traz em "next" o link com o "after" da próxima. */
function pluggyTransacoes(apiKey, accountId, de) {
  var base = '/v2/transactions?accountId=' + encodeURIComponent(accountId) + '&dateFrom=' + de;
  var todas = [], after = null, voltas = 0;
  do {
    var r = pluggyGet(apiKey, base + (after ? '&after=' + encodeURIComponent(after) : ''));
    todas = todas.concat(r.results || []);
    var m = r.next ? /[?&]after=([^&]+)/.exec(r.next) : null;
    after = m ? decodeURIComponent(m[1]) : null;
  } while (after && ++voltas < 100);
  return todas;
}

function pluggyTodas(apiKey, caminho) {
  var todas = [], pagina = 1, total = 1;
  while (pagina <= total) {
    var r = pluggyGet(apiKey, caminho + '&page=' + pagina);
    todas = todas.concat(r.results || []);
    total = r.totalPages || 1;
    pagina++;
  }
  return todas;
}

// ---------------------------------------------------------------- regras (funções puras)

/** Identifica o banco pelo nome da conta (ex.: "BTG Investimentos", "Nubank", "Itaú Personnalité"). */
function banco(conta) {
  var t = semAcento([conta.name, conta.marketingName].join(' ')).toLowerCase();
  if (t.indexOf('nubank') >= 0 || /\bnu\b/.test(t) || t.indexOf('ultravioleta') >= 0) return 'Nubank';
  if (t.indexOf('itau') >= 0 || t.indexOf('personnalite') >= 0) return 'Itaú';
  if (t.indexOf('btg') >= 0) return 'BTG';
  return '';
}

/** Nome da conta na planilha. Cada conta da Pluggy precisa de um nome único. */
function nomeConta(conta, bancoDoItem) {
  var b = banco(conta) || bancoDoItem, cartao = conta.type === 'CREDIT';
  if (b === 'BTG') return /invest/i.test(conta.name) ? 'BTG (investimentos)' : (cartao ? 'BTG (cartão)' : 'BTG (conta)');
  if (b) return b + (cartao ? ' (cartão)' : ' (conta)');
  return (conta.name || 'Conta') + (cartao ? ' (cartão)' : ' (conta)');
}

var MAPA_CATEGORIAS = [
  [/transfer|credit card payment|pagamento de fatura/i, 'Transferência'],
  [/investment/i, 'Investimento'],
  [/salary|income|wage|salario/i, 'Salário'],
  [/grocer|supermarket|mercado/i, 'Mercado'],
  [/food|restaurant|eating|delivery|bakery/i, 'Alimentação'],
  [/transport|gas station|fuel|taxi|ride|parking|toll|vehicle/i, 'Transporte'],
  [/rent|housing|mortgage/i, 'Moradia'],
  [/utilit|electric|water|telecom|internet|mobile|phone/i, 'Contas da casa'],
  [/health|pharma|drugstore|hospital|dental|medic/i, 'Saúde'],
  [/educat|school|course|book/i, 'Educação'],
  [/streaming|digital service|subscription|software/i, 'Assinaturas'],
  [/leisure|entertain|cinema|game|sport|gym/i, 'Lazer'],
  [/travel|airline|airport|hotel|accommodation|lodging/i, 'Viagem'],
  [/gift|donation/i, 'Presentes'],
  [/tax|fee|interest|tarifa|iof/i, 'Impostos e taxas'],
  [/shopping|clothing|electronic|department|online/i, 'Compras']
];

function categorizar(cat) {
  for (var i = 0; i < MAPA_CATEGORIAS.length; i++) {
    if (MAPA_CATEGORIAS[i][0].test(cat || '')) return MAPA_CATEGORIAS[i][1];
  }
  return 'Outros';
}

function ehPagamentoDeFatura(tx) {
  return /credit card payment|pagamento de fatura|pagamento recebido|fatura nubank|nu pagamentos/i
    .test((tx.category || '') + ' ' + (tx.description || ''));
}

/** Lançamentos contábeis do Nubank que se anulam em pares (ex.: "Saldo em rotativo" e "Crédito de rotativo"). */
function ehLancamentoDeRotativo(tx) {
  return /saldo em rotativo|credito de rotativo|encerramento de divida|juros de divida encerrada/
    .test(semAcento(tx.description || '').toLowerCase());
}

/** Converte uma transação da Pluggy na linha da aba Transações. */
function linhaTransacao(tx, conta, tipoConta, chavesMensalidades, titular) {
  var entrada = tx.type === 'CREDIT';
  var cat = categorizar(tx.category);
  var meta = tx.creditCardMetadata || {};
  var classe;
  if (/^BTG/.test(conta)) classe = 'Investimento'; // tudo que passa pela BTG é aplicação ou resgate
  else if (ehPagamentoDeFatura(tx) || ehLancamentoDeRotativo(tx)) classe = 'Transferência';
  else if (cat === 'Transferência') classe = (!entrada && pixParaTerceiro(tx.description, titular)) ? 'Variável' : 'Transferência';
  else if (cat === 'Investimento') classe = 'Investimento';
  else if (entrada) classe = 'Receita';
  else if (meta.totalInstallments > 1) classe = 'Parcela';
  else if (chavesMensalidades[chave(tx.description)]) classe = 'Mensalidade';
  else classe = 'Variável';
  if (cat === 'Transferência' || cat === 'Investimento') cat = 'Outros';
  return [dataLocal(tx.date), tx.description, Math.abs(tx.amount), entrada ? 'Entrada' : 'Saída',
          classe, cat, conta, 'Pluggy', tx.id];
}

/**
 * Pix ou transferência enviada para outra pessoa (não para uma conta sua) é gasto.
 * Reconhece as suas contas pelo nome do titular (ex.: "Pix enviado LEONARDO NEVES ...").
 */
function pixParaTerceiro(desc, titular) {
  var partes = semAcento(titular || '').toLowerCase().split(/\s+/).filter(function (p) { return p.length > 2; });
  if (partes.length < 2) return false; // sem o nome não dá para saber: continua como transferência
  var d = semAcento(desc || '').toLowerCase();
  if (/aplicacao|resgate|rdb|caixinha|cofrinho|valor adicionado|fatura/.test(d)) return false;
  return !(d.indexOf(partes[0]) >= 0 && d.indexOf(partes[1]) >= 0);
}

/** Chave para reconhecer o mesmo estabelecimento em meses diferentes. */
function chave(desc) {
  return semAcento(desc || '').toLowerCase()
    .replace(/\d+\s*\/\s*\d+/g, '')       // "3/10"
    .replace(/\b(parcela|parc)\b/g, '')
    .replace(/[^a-z ]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

/**
 * Procura cobranças que se repetem: mesmo estabelecimento, em pelo menos 2 meses
 * diferentes, com valores até 15% de diferença. Recebe linhas da aba Transações.
 */
function encontrarRecorrentes(linhas, jaCadastradas) {
  var grupos = {};
  linhas.forEach(function (l) {
    if (l[3] !== 'Saída' || l[4] !== 'Variável' || !l[0]) return;
    var k = chave(l[1]);
    if (!k || jaCadastradas[k]) return;
    (grupos[k] = grupos[k] || []).push(l);
  });
  var achadas = [];
  Object.keys(grupos).forEach(function (k) {
    var g = grupos[k], meses = {};
    g.forEach(function (l) { var d = new Date(l[0]); meses[d.getFullYear() * 12 + d.getMonth()] = true; });
    if (Object.keys(meses).length < 2 || g.length > Object.keys(meses).length + 1) return;
    var valores = g.map(function (l) { return l[2]; });
    var min = Math.min.apply(null, valores), max = Math.max.apply(null, valores);
    if (min <= 0 || (max - min) / max > 0.15) return;
    var ultima = g.reduce(function (a, b) { return new Date(a[0]) > new Date(b[0]) ? a : b; });
    achadas.push({ chave: k, nome: ultima[1], valor: ultima[2], dia: new Date(ultima[0]).getDate(),
                   conta: ultima[6], categoria: ultima[5] });
  });
  return achadas;
}

/** Data (1º dia do mês) da 1ª parcela, a partir de uma parcela qualquer. */
function inicioParcelamento(dataTx, numeroParcela) {
  var d = dataLocal(dataTx);
  return new Date(d.getFullYear(), d.getMonth() - (numeroParcela - 1), 1);
}

// ---------------------------------------------------------------- escrita na planilha

function prepararAbas(ss) {
  garantirColuna(ss.getSheetByName(ABA.mensalidades), 7, 'Observação');
  garantirColuna(ss.getSheetByName(ABA.parcelados), 10, 'ID externo');
  garantirColuna(ss.getSheetByName(ABA.investimentos), 9, 'ID externo');
  var cfg = ss.getSheetByName(ABA.config);
  if (cfg.getRange('A8').getValue() === '') {
    cfg.getRange('A8:C9').setValues([
      ['Renda automática', 'Sim', 'Sim: o script lê o salário nas transações. Não: você digita a renda em B2'],
      ['Palavra do salário (opcional)', '', 'Parte da descrição do depósito, se o script não achar sozinho (ex.: nome da empresa)']
    ]);
    cfg.getRange('B8:B9').setBackground('#FFF7D6');
    cfg.getRange('B8').setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Sim', 'Não']).build());
  }
  if (cfg.getRange('A10').getValue() === '') {
    cfg.getRange('A10:C10').setValues([['Dinheiro extra no mês', 0, 'Salário acima do normal (ex.: hora extra). Preenchido pelo script']]);
    cfg.getRange('B10').setNumberFormat('"R$" #,##0.00');
  }
  if (cfg.getRange('A11').getValue() === '') {
    cfg.getRange('A11:C11').setValues([['Seu nome', '', 'Para separar Pix entre as suas contas de Pix para outras pessoas (que contam como gasto). Preenchido pelo script']]);
    cfg.getRange('B11').setBackground('#FFF7D6');
  }
  // Patrimônio inclui o saldo das contas de investimento (ex.: BTG Investimentos).
  var resumo = ss.getSheetByName('Resumo');
  var rotulos = resumo.getRange('A1:A40').getValues();
  var temExtra = rotulos.some(function (l) { return l[0] === 'Dinheiro extra no mês'; });
  if (!temExtra) {
    var r = 0; rotulos.forEach(function (l, i) { if (l[0] !== '') r = i + 2; }); // linha logo após a última
    resumo.getRange(r, 1, 1, 2).setValues([['Dinheiro extra no mês', '=Config!$B$10']]);
    resumo.getRange(r, 2).setNumberFormat('"R$" #,##0.00').setBackground('#EEF2F7');
  }
  for (var i = 0; i < rotulos.length; i++) {
  }
}

/**
 * Entradas e saídas do mês no Resumo, sem transferências entre as suas contas e sem aplicações/resgates.
 * Gravadas como valores pela sincronização.
 */
function atualizarTotaisDoMes(ss) {
  var ref = new Date(ss.getSheetByName(ABA.config).getRange('B4').getValue());
  var entradas = 0, saidas = 0;
  valores(ss.getSheetByName(ABA.transacoes), 5).forEach(function (l) {
    if (!(l[0] instanceof Date) || l[0].getFullYear() !== ref.getFullYear() || l[0].getMonth() !== ref.getMonth()) return;
    if (l[3] === 'Entrada' && l[4] === 'Receita') entradas += Number(l[2]) || 0;
    if (l[3] === 'Saída' && /^(Variável|Parcela|Mensalidade)$/.test(l[4])) saidas += Number(l[2]) || 0;
  });
  var soma = function (lista) {
    return Math.round(lista.reduce(function (t, v) { return t + (typeof v === 'number' ? v : 0); }, 0) * 100) / 100;
  };
  SpreadsheetApp.flush();
  var patrimonio = soma(valores(ss.getSheetByName(ABA.investimentos), 6).map(function (l) { return l[5]; })
    .concat(valores(ss.getSheetByName(ABA.contas), 3).filter(function (l) { return l[1] === 'Conta investimento'; })
      .map(function (l) { return l[2]; })));
  var divida = soma(valores(ss.getSheetByName(ABA.parcelados), 8).map(function (l) { return l[7]; }));
  var resumo = ss.getSheetByName('Resumo');
  resumo.getRange('A1:A40').getValues().forEach(function (l, i) {
    if (l[0] === 'Entradas registradas no mês') resumo.getRange(i + 1, 2).setValue(Math.round(entradas * 100) / 100);
    if (l[0] === 'Saídas registradas no mês') resumo.getRange(i + 1, 2).setValue(Math.round(saidas * 100) / 100);
    if (l[0] === 'Patrimônio investido') resumo.getRange(i + 1, 2).setValue(patrimonio);
    if (l[0] === 'Dívida parcelada restante') resumo.getRange(i + 1, 2).setValue(divida);
  });
}

function garantirColuna(aba, col, titulo) {
  if (aba.getRange(1, col).getValue() !== titulo) {
    aba.getRange(1, col).setValue(titulo)
      .setBackground('#1F3A5F').setFontColor('#FFFFFF').setFontWeight('bold');
  }
}

function valores(aba, cols) {
  var n = ultimaLinhaCom(aba, 1);
  return n < 2 ? [] : aba.getRange(2, 1, n - 1, cols).getValues();
}

/** Última linha com conteúdo na coluna (ignora linhas só com fórmula vazia). */
function ultimaLinhaCom(aba, col) {
  var v = aba.getRange(1, col, aba.getMaxRows(), 1).getValues();
  for (var i = v.length - 1; i >= 0; i--) if (v[i][0] !== '') return i + 1;
  return 1;
}

function lerMensalidades(ss) {
  var m = {};
  valores(ss.getSheetByName(ABA.mensalidades), 6).forEach(function (l) {
    if (l[0] && l[5] === 'Sim') m[chave(l[0])] = true;
  });
  return m;
}

function gravarTransacoes(ss, txs, conta, tipoConta, mensalidades, titular) {
  var aba = ss.getSheetByName(ABA.transacoes);
  removerPendentes(aba, conta);
  var ids = {};
  valores(aba, 9).forEach(function (l) { if (l[8]) ids[l[8]] = true; });
  var amanha = Utilities.formatDate(new Date(Date.now() + 864e5), 'UTC', 'yyyy-MM-dd');
  var cartao = tipoConta === 'CREDIT';
  var novas = txs.filter(function (t) {
    var pendente = t.status === 'PENDING';
    return !ids[t.id] && (!pendente || cartao) && String(t.date).slice(0, 10) < amanha;
  }).map(function (t) {
    var l = linhaTransacao(t, conta, tipoConta, mensalidades, titular);
    if (t.status === 'PENDING') l[8] = 'pend:' + t.id; // some quando a compra for confirmada
    return l;
  });
  if (!novas.length) return 0;
  var ini = ultimaLinhaCom(aba, 1) + 1;
  aba.getRange(ini, 1, novas.length, 9).setValues(novas);
  aba.getRange(ini, 1, novas.length, 1).setNumberFormat('dd/MM/yyyy');
  aba.getRange(ini, 3, novas.length, 1).setNumberFormat('"R$" #,##0.00');
  return novas.length;
}

/**
 * Monta os parcelamentos ativos a partir das transações do cartão.
 * Cada parcela vem como uma transação; todas as parcelas da mesma compra viram uma linha só.
 */
function planosParcelados(txs, conta, ref, hoje) {
  hoje = hoje || new Date();
  // A Pluggy manda cada parcela como uma transação, incluindo as futuras, e as datas nem sempre seguem
  // o mesmo padrão. Agrupamos por loja + nº de parcelas + valor (em reais inteiros, porque a 1ª parcela
  // às vezes difere em centavos) e deduzimos em que parcela a compra está neste mês.
  var grupos = {};
  txs.forEach(function (t) {
    var m = t.creditCardMetadata || {};
    if (!(m.totalInstallments > 1) || t.type !== 'DEBIT') return;
    var desc = String(t.description || '').replace(/\s*\d+\s*\/\s*\d+\s*$/, '');
    var valor = Math.round(Math.abs(t.amount) * 100) / 100;
    var k = chaveParcelado(t);
    (grupos[k] = grupos[k] || { desc: desc, total: m.totalInstallments, valores: {}, txs: [] })
      .txs.push({ data: String(t.date).slice(0, 10), n: m.installmentNumber || 1 });
    grupos[k].valores[valor] = (grupos[k].valores[valor] || 0) + 1;
  });
  var mesRef = ref.getFullYear() * 12 + ref.getMonth();
  var mes = function (iso) { var d = dataLocal(iso); return d.getFullYear() * 12 + d.getMonth(); };
  var planos = [];
  Object.keys(grupos).forEach(function (k) {
    var g = grupos[k], inicioMes;
    var futuras = g.txs.filter(function (x) { return mes(x.data) >= mesRef; }).length;
    var datas = {};
    g.txs.forEach(function (x) { datas[x.data] = true; });
    var ultimoMes = Math.max.apply(null, g.txs.map(function (x) { return mes(x.data); }));
    if (ultimoMes > mesRef) {
      // A Pluggy já mostra as parcelas dos próximos meses: as restantes (com a deste mês) são essas.
      inicioMes = mesRef - (g.total - Math.min(futuras, g.total));
    } else if (Object.keys(datas).length === 1) {
      // Todas com a mesma data: é a data da compra.
      inicioMes = mes(g.txs[0].data);
    } else {
      var ult = g.txs.reduce(function (a, b) { return a.data > b.data ? a : b; });
      inicioMes = mes(ult.data) - (ult.n - 1);
    }
    if (mesRef - inicioMes >= g.total) return; // já quitado
    // Parcela do mês que não veio: a compra foi antecipada (paga por inteiro) ou cancelada.
    // Cada parcela cai todo mês no mesmo dia da última; damos 3 dias de folga.
    if (ultimoMes < mesRef && hoje.getFullYear() * 12 + hoje.getMonth() === mesRef) {
      var ultima = g.txs.reduce(function (a, b) { return a.data > b.data ? a : b; });
      if (hoje.getDate() > dataLocal(ultima.data).getDate() + 3) return;
    }
    var valor = Object.keys(g.valores).sort(function (a, b) { return g.valores[b] - g.valores[a]; })[0];
    var inicio = new Date(Math.floor(inicioMes / 12), inicioMes % 12, 1);
    // A mesma compra às vezes vem com nomes diferentes (ex.: "AMAZON PRIME BR" e "Amazon Prime").
    var mesmo = planos.some(function (p) {
      return p[2] === g.total && Math.round(p[1]) === Math.round(Number(valor)) && p[3].getTime() === inicio.getTime();
    });
    if (!mesmo) planos.push([g.desc, Number(valor), g.total, inicio, conta, k]);
  });
  return planos;
}

/** Apaga as compras pendentes da conta: a sincronização grava de novo as que continuam pendentes. */
function removerPendentes(aba, conta) {
  var linhas = valores(aba, 9);
  var manter = linhas.filter(function (l) { return !(l[6] === conta && /^pend:/.test(l[8])); });
  if (manter.length === linhas.length) return;
  aba.getRange(2, 1, linhas.length, 9).clearContent();
  if (manter.length) aba.getRange(2, 1, manter.length, 9).setValues(manter);
}

/** A mesma movimentação da BTG pode vir de duas conexões (a antiga e a "BTG Investimentos"). */
function removerDuplicadasBTG(ss) {
  var aba = ss.getSheetByName(ABA.transacoes);
  var linhas = valores(aba, 9), vistas = {};
  var manter = linhas.filter(function (l) {
    if (!/^BTG/.test(l[6]) || l[7] !== 'Pluggy' || !(l[0] instanceof Date)) return true;
    var k = [l[0].getTime(), l[1], l[2], l[3], l[6]].join('|');
    if (vistas[k]) return false;
    return (vistas[k] = true);
  });
  if (manter.length === linhas.length) return;
  aba.getRange(2, 1, linhas.length, 9).clearContent();
  if (manter.length) aba.getRange(2, 1, manter.length, 9).setValues(manter);
}

/**
 * Pix pago com o cartão: a conta recebe "Valor adicionado na conta por cartão de crédito" e o Pix sai logo depois.
 * O gasto já aparece no cartão, então o Pix da conta vira transferência.
 */
function pixPagoComCartao(ss) {
  var aba = ss.getSheetByName(ABA.transacoes);
  var linhas = valores(aba, 9);
  var adicionados = linhas.filter(function (l) {
    return l[3] === 'Entrada' && l[0] instanceof Date && /valor adicionado/i.test(semAcento(l[1]));
  });
  linhas.forEach(function (l, i) {
    if (l[3] !== 'Saída' || l[4] !== 'Variável' || !(l[0] instanceof Date) || /cart/i.test(l[6])) return;
    var par = adicionados.some(function (a) {
      return a[6] === l[6] && Math.abs(a[2] - l[2]) < 0.01 && Math.abs(a[0] - l[0]) <= 864e5;
    });
    if (par) aba.getRange(i + 2, 5).setValue('Transferência');
  });
}

/** Uma vez só: Pix já gravados que foram para outras pessoas passam a contar como gasto. */
function migrarPixParaTerceiros(ss, titular) {
  var props = PropertiesService.getScriptProperties();
  if (!titular || props.getProperty('MIGRACAO_PIX') === '1') return;
  var aba = ss.getSheetByName(ABA.transacoes);
  valores(aba, 9).forEach(function (l, i) {
    if (l[7] === 'Pluggy' && l[3] === 'Saída' && l[4] === 'Transferência' && !/^BTG/.test(l[6]) &&
        !ehPagamentoDeFatura({ description: l[1] }) && pixParaTerceiro(l[1], titular)) {
      aba.getRange(i + 2, 5).setValue('Variável');
    }
  });
  props.setProperty('MIGRACAO_PIX', '1');
}

/** Nome do titular das contas (Config B11). Se estiver vazio, pergunta à Pluggy uma vez. */
function nomeDoTitular(ss, apiKey, itens) {
  var cfg = ss.getSheetByName(ABA.config);
  var nome = String(cfg.getRange('B11').getValue() || '').trim();
  if (nome) return nome;
  for (var i = 0; i < itens.length && !nome; i++) {
    try { nome = (pluggyGet(apiKey, '/identity?itemId=' + itens[i]) || {}).fullName || ''; } catch (e) { /* conexão sem identidade */ }
  }
  if (nome) cfg.getRange('B11').setValue(nome);
  return nome;
}

/** Transações antigas da BTG que ainda não estão como Investimento. */
function reclassificarBTG(ss) {
  var aba = ss.getSheetByName(ABA.transacoes);
  valores(aba, 7).forEach(function (l, i) {
    if (/^BTG/.test(l[6]) && l[4] !== 'Investimento') aba.getRange(i + 2, 5).setValue('Investimento');
  });
}

/** Tira de Transações as parcelas com data futura que a Pluggy manda (elas já ficam em Parcelados). */
function removerParcelasFuturas(ss) {
  var aba = ss.getSheetByName(ABA.transacoes);
  var linhas = valores(aba, 9);
  var limite = new Date(); limite.setHours(23, 59, 59);
  var manter = linhas.filter(function (l) { return !(l[7] === 'Pluggy' && l[0] instanceof Date && l[0] > limite); });
  if (manter.length === linhas.length) return;
  aba.getRange(2, 1, linhas.length, 9).clearContent();
  if (manter.length) aba.getRange(2, 1, manter.length, 9).setValues(manter);
}

/** Reescreve as linhas da Pluggy em Parcelados e mantém as que você digitou à mão. */
function reconstruirParcelados(ss, cartoes) {
  if (!cartoes.length) return;
  var aba = ss.getSheetByName(ABA.parcelados);
  var ref = new Date(ss.getSheetByName(ABA.config).getRange('B4').getValue());
  var n = ultimaLinhaCom(aba, 1);
  var manuais = [], presentes = {};
  if (n >= 2) {
    aba.getRange(2, 1, n - 1, 10).getValues().forEach(function (l) {
      if (l[0] !== '' && l[9] === '') manuais.push([l[0], l[1], l[2], l[3], l[4], '']);
      if (l[9] !== '') presentes[l[9]] = true;
    });
    aba.getRange(2, 1, n - 1, 5).clearContent();
    aba.getRange(2, 10, n - 1, 1).clearContent();
  }
  // Linha da Pluggy que você apagou (ex.: compra cancelada) não volta mais.
  var props = PropertiesService.getScriptProperties();
  var ignorados = JSON.parse(props.getProperty('PARCELADOS_IGNORADOS') || '{}');
  var gravados = JSON.parse(props.getProperty('PARCELADOS_GRAVADOS') || '[]');
  gravados.forEach(function (id) { if (!presentes[id]) ignorados[id] = true; });
  var linhas = manuais;
  cartoes.forEach(function (c) {
    linhas = linhas.concat(planosParcelados(c.txs, c.conta, ref).filter(function (l) { return !ignorados[l[5]]; }));
  });
  props.setProperty('PARCELADOS_IGNORADOS', JSON.stringify(ignorados));
  props.setProperty('PARCELADOS_GRAVADOS', JSON.stringify(linhas.map(function (l) { return l[5]; }).filter(String)));
  if (!linhas.length) {
    if (n >= 2) aba.getRange(2, 6, n - 1, 4).clearContent();
    return;
  }
  aba.getRange(2, 1, linhas.length, 5).setValues(linhas.map(function (l) { return l.slice(0, 5); }));
  aba.getRange(2, 10, linhas.length, 1).setValues(linhas.map(function (l) { return [l[5]]; }));
  aba.getRange(2, 4, linhas.length, 1).setNumberFormat('dd/MM/yyyy');
  aba.getRange(2, 2, linhas.length, 1).setNumberFormat('"R$" #,##0.00');
  aba.getRange(2, 6, linhas.length, 4).setValues(linhas.map(function (l) { return calculosParcelado(l, ref); }));
  aba.getRange(2, 8, linhas.length, 1).setNumberFormat('"R$" #,##0.00');
  if (n > linhas.length + 1) aba.getRange(linhas.length + 2, 6, n - linhas.length - 1, 4).clearContent();
}

/** Repete as fórmulas das colunas calculadas quando a linha passa do que veio pronto. */
/**
 * Colunas calculadas de Parcelados (F a I), gravadas como valores a cada sincronização.
 * Fórmulas escritas pelo script com acentos davam #ERROR! na planilha.
 */
function calculosParcelado(l, ref) {
  var total = Number(l[2]), ini = l[3] instanceof Date ? l[3] : new Date(l[3]);
  if (!total || isNaN(ini)) return ['', '', '', ''];
  var el = (ref.getFullYear() - ini.getFullYear()) * 12 + ref.getMonth() - ini.getMonth();
  var ativa = el >= 0 && el < total;
  var restantes = Math.max(0, Math.min(total, total - el));
  // "4 de 12" e não "4/12": a planilha transformava "4/12" em data.
  return [ativa ? (el + 1) + ' de ' + total : (el < 0 ? 'Ainda não começou' : 'Quitado'),
          restantes, Math.round(restantes * Number(l[1]) * 100) / 100, ativa ? 'Sim' : 'Não'];
}

/**
 * Dia em que a fatura fecha: Config B5, ou o que a Pluggy informar (que fica salvo em B5).
 */
function diaDeFechamento(ss, conta) {
  var cfg = ss.getSheetByName(ABA.config);
  var dia = Number(cfg.getRange('B5').getValue());
  if (dia >= 1 && dia <= 31) return dia;
  var fecha = (conta.creditData || {}).balanceCloseDate;
  if (!fecha) return 0;
  dia = dataLocal(fecha).getDate();
  cfg.getRange('B5').setValue(dia);
  return dia;
}

/**
 * Fatura aberta = fatura que fechou + compras e parcelas desde o fechamento − pagamentos e estornos.
 * O pagamento da fatura fechada cai depois do fechamento, por isso ela entra na conta.
 * O "saldo" do cartão na Pluggy é o limite usado (inclui as parcelas futuras), não a fatura.
 * anterior: total da fatura fechada (null se a Pluggy não informar). ignorados: parcelamentos cancelados.
 */
function faturaAberta(txs, dia, hoje, anterior, ignorados) {
  if (!dia) return null;
  ignorados = ignorados || {};
  var fechou = new Date(hoje.getFullYear(), hoje.getMonth(), dia);
  if (fechou > hoje) fechou = new Date(hoje.getFullYear(), hoje.getMonth() - 1, dia);
  // Sem o total da fatura fechada, os pagamentos dos primeiros dias são dela e ficam de fora.
  var vencimento = new Date(fechou.getFullYear(), fechou.getMonth(), fechou.getDate() + 10);
  var compras = 0, creditos = 0, achou = false;
  txs.forEach(function (t) {
    var d = dataLocal(t.date);
    if (d < fechou || d > hoje) return;
    if (ignorados[chaveParcelado(t)]) return;
    achou = true;
    if (t.type !== 'CREDIT') compras += Math.abs(t.amount);
    else if (anterior != null || d > vencimento || !ehPagamentoDeFatura(t)) creditos += Math.abs(t.amount);
  });
  if (!achou) return null;
  var r = function (v) { return Math.round(v * 100) / 100; };
  return { valor: r((anterior || 0) + compras - creditos), compras: r(compras), creditos: r(creditos),
           anterior: anterior == null ? null : r(anterior) };
}

/** Total da última fatura fechada do cartão (GET /bills), ou null. */
function ultimaFatura(apiKey, accountId) {
  try {
    var faturas = pluggyGet(apiKey, '/bills?accountId=' + encodeURIComponent(accountId)).results || [];
    if (!faturas.length) return null;
    var ult = faturas.reduce(function (a, b) { return String(a.dueDate) > String(b.dueDate) ? a : b; });
    return ult.totalAmount != null ? Math.abs(ult.totalAmount) : null;
  } catch (e) {
    return null;
  }
}

function parceladosIgnorados() {
  return JSON.parse(PropertiesService.getScriptProperties().getProperty('PARCELADOS_IGNORADOS') || '{}');
}

/** Mesma chave que planosParcelados usa para a compra parcelada (vazia se não for parcela). */
function chaveParcelado(t) {
  var m = t.creditCardMetadata || {};
  if (!(m.totalInstallments > 1)) return '';
  var desc = String(t.description || '').replace(/\s*\d+\s*\/\s*\d+\s*$/, '');
  return chave(desc) + '|' + m.totalInstallments + '|' + Math.round(Math.abs(t.amount));
}

/** Coluna C do cartão passa a ser a fatura aberta; o limite usado fica na coluna G. */
function gravarFatura(ss, nome, valor) {
  var aba = ss.getSheetByName(ABA.contas);
  garantirColuna(aba, 7, 'Limite usado');
  var linhas = valores(aba, 3);
  for (var i = 0; i < linhas.length; i++) {
    if (linhas[i][0] !== nome) continue;
    aba.getRange(i + 2, 7).setValue(linhas[i][2]).setNumberFormat('"R$" #,##0.00');
    aba.getRange(i + 2, 3).setValue(valor);
  }
}

function atualizarConta(ss, nome, conta) {
  var aba = ss.getSheetByName(ABA.contas);
  var linhas = valores(aba, 6), r = -1;
  for (var i = 0; i < linhas.length; i++) if (linhas[i][0] === nome) r = i + 2;
  if (r < 0) r = ultimaLinhaCom(aba, 1) + 1;
  var credito = conta.creditData || {};
  aba.getRange(r, 1, 1, 6).setValues([[
    nome, conta.type === 'CREDIT' ? 'Cartão de crédito' : (/invest/i.test(nome) ? 'Conta investimento' : 'Conta corrente'),
    conta.balance, credito.creditLimit || '', new Date(), 'Pluggy'
  ]]);
}

var COLUNAS_DETALHE_INVEST = ['Código', 'Valor aplicado', 'Lucro / prejuízo', 'Vencimento', 'Taxa', 'Emissor'];

/** Linha da aba Investimentos para uma posição da Pluggy (colunas A-E, G-I e J-O). */
function linhaInvestimento(inv, inst, hoje) {
  var qtd = inv.quantity || 1;
  var preco = inv.quantity ? (inv.value || inv.balance / inv.quantity) : inv.balance;
  var aplicado = inv.amountOriginal || inv.amount || '';
  var lucro = inv.amountProfit != null ? inv.amountProfit : (aplicado ? inv.balance - aplicado : '');
  var taxa = '';
  if (inv.rate != null) taxa = inv.rate + (inv.rateType === 'CDI' || inv.rateType === 'SELIC' ? '% do ' + inv.rateType : '%') +
                               (inv.fixedAnnualRate ? ' + ' + inv.fixedAnnualRate + '% a.a.' : '');
  else if (inv.fixedAnnualRate) taxa = inv.fixedAnnualRate + '% a.a.';
  return [inv.name, inst, tipoInvestimento(inv), qtd, preco, hoje, 'Pluggy', inv.id,
          inv.code || inv.isin || '', aplicado, lucro, inv.dueDate ? dataLocal(inv.dueDate) : '', taxa,
          inv.issuer || ''];
}

/** Reescreve as posições da Pluggy (só as com saldo) e mantém as linhas manuais, como o Bitcoin. */
function reconstruirInvestimentos(ss, lista) {
  var aba = ss.getSheetByName(ABA.investimentos);
  COLUNAS_DETALHE_INVEST.forEach(function (t, i) { garantirColuna(aba, 10 + i, t); });
  var n = ultimaLinhaCom(aba, 1);
  var manuais = [];
  if (n >= 2) {
    aba.getRange(2, 1, n - 1, 15).getValues().forEach(function (l) {
      if (l[0] !== '' && l[8] === '') manuais.push([l[0], l[1], l[2], l[3], l[4], l[6], l[7], ''].concat(l.slice(9, 15)));
    });
    aba.getRange(2, 1, n - 1, 5).clearContent();
    aba.getRange(2, 7, n - 1, 9).clearContent();
  }
  var hoje = new Date();
  var novas = lista.filter(function (x) { return (x.inv.balance || 0) > 0.009; })
    .map(function (x) { return linhaInvestimento(x.inv, x.inst, hoje); });
  var linhas = manuais.concat(novas);
  if (!linhas.length) return;
  aba.getRange(2, 1, linhas.length, 5).setValues(linhas.map(function (l) { return l.slice(0, 5); }));
  aba.getRange(2, 7, linhas.length, 9).setValues(linhas.map(function (l) { return l.slice(5, 14); }));
  aba.getRange(2, 11, linhas.length, 2).setNumberFormat('"R$" #,##0.00'); // valor aplicado e lucro
  aba.getRange(2, 13, linhas.length, 1).setNumberFormat('dd/MM/yyyy');     // vencimento
  for (var r = 2; r < 2 + linhas.length; r++) {
    if (!aba.getRange(r, 6).getFormula()) aba.getRange(r, 6).setFormula('=IF(A' + r + '="","",D' + r + '*E' + r + ')');
    // Linha digitada à mão com código da B3 (ex.: PETR4, HGLG11): o preço vem do Google Finance.
    var l = linhas[r - 2];
    if (l[7] === '' && /^[A-Z]{4}\d{1,2}$/.test(String(l[8]).trim().toUpperCase())) {
      aba.getRange(r, 5).setFormula('=GOOGLEFINANCE("BVMF:"&UPPER(TRIM(J' + r + ')),"price")');
    }
  }
}

/**
 * Se a corretora já manda as posições detalhadas e o saldo da conta é o total delas,
 * o saldo da conta não entra de novo no patrimônio (evita contar duas vezes).
 */
function evitarPatrimonioDuplicado(ss, lista) {
  var porInst = {};
  lista.forEach(function (x) { porInst[x.inst] = (porInst[x.inst] || 0) + (x.inv.balance || 0); });
  var aba = ss.getSheetByName(ABA.contas);
  valores(aba, 3).forEach(function (l, i) {
    if (String(l[1]).indexOf('Conta investimento') !== 0) return;
    var total = porInst[String(l[0]).replace(/ \(.*\)$/, '') + ' (investimentos)'];
    var duplicado = total && Math.abs(Number(l[2]) - total) <= Math.max(1, total * 0.05);
    aba.getRange(i + 2, 2).setValue(duplicado ? 'Conta investimento (já nas posições)' : 'Conta investimento');
  });
}

/** Apaga da aba Contas as contas da Pluggy que não vieram nesta sincronização (ex.: conexão removida). */
function limparContasAntigas(ss, vistas) {
  var aba = ss.getSheetByName(ABA.contas);
  var linhas = valores(aba, 6);
  for (var i = linhas.length - 1; i >= 0; i--) {
    if (linhas[i][5] === 'Pluggy' && linhas[i][4] !== '' && !vistas[linhas[i][0]]) aba.deleteRow(i + 2);
  }
}

/** Troca o nome de uma conta em todas as abas (ex.: "croma-platinum (cartão)" vira "Nubank (cartão)"). */
function renomearConta(ss, antigo, novo) {
  var contas = ss.getSheetByName(ABA.contas);
  var existe = valores(contas, 1).some(function (l) { return l[0] === antigo; });
  if (!existe) return;
  [[ABA.transacoes, 7], [ABA.parcelados, 5], [ABA.mensalidades, 4], [ABA.contas, 1]].forEach(function (x) {
    var aba = ss.getSheetByName(x[0]), n = ultimaLinhaCom(aba, 1);
    if (n < 2) return;
    var rg = aba.getRange(2, x[1], n - 1, 1), v = rg.getValues(), mudou = false;
    v.forEach(function (l) { if (l[0] === antigo) { l[0] = novo; mudou = true; } });
    if (mudou) rg.setValues(v);
  });
  // Remove a linha vazia que veio pronta na planilha com o nome novo.
  var linhas = valores(contas, 3);
  for (var i = linhas.length - 1; i >= 0; i--) {
    if (linhas[i][0] === novo && linhas[i][2] === '') { contas.deleteRow(i + 2); break; }
  }
}

function tipoInvestimento(inv) {
  var t = (inv.type || '') + ' ' + (inv.subtype || '');
  if (/TREASUR|TESOURO/i.test(t)) return 'Tesouro';
  if (/REAL_ESTATE|FII/i.test(t)) return 'FIIs';
  if (/\bETF\b/i.test(t)) return 'ETFs';
  if (/PENSION|PREVID/i.test(t)) return 'Previdência';
  if (/STOCK_FUND|MULTIMARKET|FIXED_INCOME_FUND|MUTUAL_FUND|INVESTMENT_FUND|FUND/i.test(t)) return 'Fundos';
  if (/EQUITY|STOCK|BDR/i.test(t)) return 'Ações';
  if (/COE/i.test(t)) return 'COE';
  if (/CRYPTO/i.test(t)) return 'Cripto';
  return 'Renda fixa';
}

function detectarRecorrentes(ss) {
  var abaT = ss.getSheetByName(ABA.transacoes), abaM = ss.getSheetByName(ABA.mensalidades);
  var ja = {};
  valores(abaM, 1).forEach(function (l) { if (l[0]) ja[chave(l[0])] = true; });
  var linhas = valores(abaT, 9);
  var achadas = encontrarRecorrentes(linhas, ja);
  if (!achadas.length) return 0;
  var r = ultimaLinhaCom(abaM, 1) + 1;
  abaM.getRange(r, 1, achadas.length, 7).setValues(achadas.map(function (a) {
    return [a.nome, a.valor, a.dia, a.conta, a.categoria === 'Outros' ? 'Assinaturas' : a.categoria, 'Sim',
            'Detectada automaticamente. Revise e mude Ativa? para Não se estiver errada.'];
  }));
  abaM.getRange(r, 2, achadas.length, 1).setNumberFormat('"R$" #,##0.00');
  // As cobranças passam a contar como mensalidade, para não descontar duas vezes.
  var ks = {};
  achadas.forEach(function (a) { ks[a.chave] = true; });
  linhas.forEach(function (l, i) {
    if (l[4] === 'Variável' && ks[chave(l[1])]) abaT.getRange(i + 2, 5).setValue('Mensalidade');
  });
  return achadas.length;
}

// ---------------------------------------------------------------- salário

// "Remuneração" fica de fora: no Nubank é o rendimento da conta, não salário.
var PALAVRAS_SALARIO = /salario|folha de pag|proventos|adiantamento sal|pagto sal|pgto sal/;
var SALARIO_MINIMO_DETECTAVEL = 500;

/**
 * Encontra o salário nas transações (linhas da aba Transações).
 * 1) palavra que você definir na Config; 2) categoria Salário ou palavras como "salário" e "proventos";
 * 3) senão, a maior entrada que se repete todo mês com valor parecido (acima de R$ 1.000).
 * A renda base é o salário normal: o depósito típico (mediana) vezes quantos depósitos caem por mês.
 * O que passar disso no mês de referência (hora extra, por exemplo) vira dinheiro extra.
 */
function detectarRenda(linhas, palavra, ref) {
  var entradas = [];
  linhas.forEach(function (l, i) {
    if (l[3] === 'Entrada' && l[4] !== 'Investimento' && l[0]) entradas.push({ l: l, i: i });
  });
  var cand;
  if (palavra) {
    var p = chave(palavra);
    cand = entradas.filter(function (e) { return chave(e.l[1]).indexOf(p) >= 0; });
  } else {
    cand = entradas.filter(function (e) {
      return e.l[2] >= SALARIO_MINIMO_DETECTAVEL &&
        (e.l[5] === 'Salário' || PALAVRAS_SALARIO.test(semAcento(e.l[1]).toLowerCase()));
    });
    if (!cand.length) cand = maiorEntradaRecorrente(entradas);
  }
  if (!cand.length) return null;
  var porMes = {};
  cand.forEach(function (e) {
    var d = new Date(e.l[0]), m = d.getFullYear() * 12 + d.getMonth();
    porMes[m] = porMes[m] || { total: 0, n: 0 };
    porMes[m].total += e.l[2]; porMes[m].n++;
  });
  var valores = cand.map(function (e) { return e.l[2]; }).sort(function (a, b) { return a - b; });
  var meio = Math.floor(valores.length / 2);
  var mediana = valores.length % 2 ? valores[meio] : (valores[meio - 1] + valores[meio]) / 2;
  var contagem = {};
  Object.keys(porMes).forEach(function (m) { contagem[porMes[m].n] = (contagem[porMes[m].n] || 0) + 1; });
  var porMesTipico = Number(Object.keys(contagem).sort(function (a, b) { return contagem[b] - contagem[a] || b - a; })[0]);
  var base = Math.round(mediana * porMesTipico * 100) / 100;
  var mesRef = ref ? ref.getFullYear() * 12 + ref.getMonth() : null;
  var noMes = mesRef !== null && porMes[mesRef] ? porMes[mesRef].total : 0;
  var ultima = cand.reduce(function (a, b) { return new Date(a.l[0]) > new Date(b.l[0]) ? a : b; });
  var extra = Math.round((noMes - base) * 100) / 100;
  if (extra < Math.max(50, base * 0.02)) extra = 0; // diferença de centavos não é dinheiro extra
  return { valor: base, extra: extra, descricao: ultima.l[1],
           data: new Date(ultima.l[0]), indices: cand.map(function (e) { return e.i; }) };
}

function maiorEntradaRecorrente(entradas) {
  var grupos = {};
  entradas.forEach(function (e) {
    if (e.l[2] < 1000) return;
    var k = chave(e.l[1]);
    if (k) (grupos[k] = grupos[k] || []).push(e);
  });
  var melhor = [], melhorMedia = 0;
  Object.keys(grupos).forEach(function (k) {
    var g = grupos[k], porMes = {};
    g.forEach(function (e) { var d = new Date(e.l[0]); var m = d.getFullYear() * 12 + d.getMonth(); porMes[m] = (porMes[m] || 0) + e.l[2]; });
    var totais = Object.keys(porMes).map(function (m) { return porMes[m]; });
    if (totais.length < 2 || g.length > totais.length * 2) return;
    var min = Math.min.apply(null, totais), max = Math.max.apply(null, totais);
    if (max / min > 1.25) return;
    var media = totais.reduce(function (a, b) { return a + b; }, 0) / totais.length;
    if (media > melhorMedia) { melhorMedia = media; melhor = g; }
  });
  return melhor;
}

function atualizarRenda(ss) {
  var cfg = ss.getSheetByName(ABA.config);
  if (cfg.getRange('B8').getValue() === 'Não') return '';
  var abaT = ss.getSheetByName(ABA.transacoes);
  var linhas = valores(abaT, 9);
  var r = detectarRenda(linhas, String(cfg.getRange('B9').getValue() || '').trim(), new Date(cfg.getRange('B4').getValue()));
  if (!r) {
    // Não apaga uma renda digitada à mão; só desfaz um valor que o próprio script tinha posto.
    if (/^Automático/.test(String(cfg.getRange('C2').getValue()))) {
      cfg.getRange('B2').setValue(0);
      cfg.getRange('C2').setValue('Salário não encontrado nas transações. Digite a renda aqui e mude B8 para Não, ou coloque em B9 parte da descrição do depósito.');
    }
    return 'Salário não encontrado nas transações.';
  }
  cfg.getRange('B2').setValue(r.valor);
  cfg.getRange('B10').setValue(r.extra);
  cfg.getRange('C2').setValue('Automático: salário normal pelos depósitos "' + r.descricao + '" (último em ' +
    Utilities.formatDate(r.data, ss.getSpreadsheetTimeZone(), 'dd/MM') + '). Para digitar à mão, mude B8 para Não.');
  r.indices.forEach(function (i) {
    if (linhas[i][4] !== 'Receita' || linhas[i][5] !== 'Salário') abaT.getRange(i + 2, 5, 1, 2).setValues([['Receita', 'Salário']]);
  });
  return 'Renda base: R$ ' + r.valor.toFixed(2) + (r.extra ? ' + extra no mês: R$ ' + r.extra.toFixed(2) : '');
}

// ---------------------------------------------------------------- Bitcoin

function sincronizarBitcoin(props, ss) {
  var xpub = props.getProperty('BTC_XPUB');
  var enderecos = (props.getProperty('BTC_ADDRESSES') || '').split(',').map(trim).filter(String);
  var aba = ss.getSheetByName(ABA.investimentos);
  var r = linhaBitcoin(aba);
  var btc;
  if (xpub) btc = saldoXpub(xpub);
  else if (enderecos.length) btc = enderecos.reduce(function (s, a) { return s + saldoEndereco(a); }, 0);
  else btc = Number(aba.getRange(r, 4).getValue()) || 0; // quantidade digitada à mão
  var preco = precoBitcoinBRL();
  aba.getRange(r, 4, 1, 2).setValues([[btc, preco]]);
  aba.getRange(r, 7).setValue(new Date());
  return 'Bitcoin: ' + btc + ' BTC a R$ ' + preco.toFixed(2);
}

function linhaBitcoin(aba) {
  var linhas = valores(aba, 1);
  for (var i = 0; i < linhas.length; i++) if (/bitcoin/i.test(linhas[i][0])) return i + 2;
  var r = ultimaLinhaCom(aba, 1) + 1;
  aba.getRange(r, 1, 1, 3).setValues([['Bitcoin', 'BlueWallet (Bitcoin)', 'Cripto']]);
  aba.getRange(r, 8).setValue('Blockchain');
  return r;
}

function saldoXpub(xpub) {
  var r = UrlFetchApp.fetch('https://api.blockchair.com/bitcoin/dashboards/xpub/' + xpub, { muteHttpExceptions: true });
  if (r.getResponseCode() !== 200) throw new Error('não consegui ler o xpub (' + r.getResponseCode() + ')');
  var d = JSON.parse(r.getContentText()).data;
  return d[Object.keys(d)[0]].xpub.balance / 1e8;
}

function saldoEndereco(addr) {
  var j = JSON.parse(UrlFetchApp.fetch('https://mempool.space/api/address/' + addr).getContentText());
  var c = j.chain_stats, m = j.mempool_stats;
  return (c.funded_txo_sum - c.spent_txo_sum + m.funded_txo_sum - m.spent_txo_sum) / 1e8;
}

function precoBitcoinBRL() {
  var j = JSON.parse(UrlFetchApp.fetch('https://api.coingecko.com/api/v3/simple/price?ids=bitcoin&vs_currencies=brl').getContentText());
  return j.bitcoin.brl;
}

// ---------------------------------------------------------------- utilidades

function marcarUltimaSync(ss) {
  var aba = ss.getSheetByName(ABA.config);
  aba.getRange('A7:C7').setValues([['Última sincronização', new Date(), 'Preenchido pelo script']]);
  aba.getRange('B7').setNumberFormat('dd/MM/yyyy HH:mm');
}

function avisar(msg) {
  try { SpreadsheetApp.getActive().toast(msg, 'Assistente', 10); } catch (e) { /* rodando pelo gatilho */ }
}

/** Usa só a parte da data (AAAA-MM-DD), para o fuso não jogar a compra para o dia anterior. */
function dataLocal(iso) {
  var p = String(iso).slice(0, 10).split('-');
  return new Date(+p[0], +p[1] - 1, +p[2]);
}

function trim(s) { return s.trim(); }


function semAcento(s) { return String(s).normalize('NFD').replace(/[̀-ͯ]/g, ''); }

// ---------------------------------------------------------------- API do app (etapa 3)

/**
 * Gera o código de acesso do app e mostra no registro o link de configuração.
 * Rode uma vez depois de implantar como App da Web (cole a URL /exec abaixo).
 */
function gerarLinkDoApp() {
  var urlDoScript = '';   // cole aqui a URL que termina em /exec (Implantar > Gerenciar implantações)
  var urlDoApp = 'https://letinho12.github.io/assistente-financeiro/';
  var props = PropertiesService.getScriptProperties();
  var token = props.getProperty('APP_TOKEN');
  if (!token) {
    token = Utilities.getUuid().replace(/-/g, '');
    props.setProperty('APP_TOKEN', token);
  }
  if (!urlDoScript || !urlDoApp) throw new Error('Preencha urlDoScript e urlDoApp dentro de gerarLinkDoApp().');
  Logger.log('Abra este link no celular e no computador (uma vez em cada):\n' +
             urlDoApp + '#api=' + encodeURIComponent(urlDoScript) + '&token=' + token);
}

/** Entrega os dados da planilha para o app. Só responde com o código de acesso certo. */
function doGet(e) {
  var token = PropertiesService.getScriptProperties().getProperty('APP_TOKEN');
  if (!token || !e || !e.parameter || e.parameter.token !== token) {
    return json({ erro: 'acesso negado' });
  }
  return json(dadosDoApp(SpreadsheetApp.getActive()));
}

function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function dadosDoApp(ss) {
  var tz = ss.getSpreadsheetTimeZone();
  var iso = function (d) { return d instanceof Date ? Utilities.formatDate(d, tz, 'yyyy-MM-dd') : ''; };
  var num = function (v) { return typeof v === 'number' ? Math.round(v * 100) / 100 : 0; };

  var resumo = {};
  ss.getSheetByName('Resumo').getRange('A1:B40').getValues().forEach(function (l) {
    if (l[0] && l[0] !== 'Resumo do mês') resumo[l[0]] = typeof l[1] === 'number' ? num(l[1]) : String(l[1]);
  });
  var cfg = ss.getSheetByName(ABA.config).getRange('A1:B12').getValues();
  var config = {};
  cfg.forEach(function (l) { if (l[0]) config[l[0]] = l[1]; });

  var categorias = ss.getSheetByName('Resumo').getRange('D4:E30').getValues()
    .filter(function (l) { return l[0] && typeof l[1] === 'number'; })
    .map(function (l) { return { categoria: l[0], valor: num(l[1]) }; });

  var faturas = ss.getSheetByName('Faturas Futuras').getRange('A2:E13').getValues()
    .filter(function (l) { return l[0] instanceof Date; })
    .map(function (l) { return { mes: iso(l[0]).slice(0, 7), parcelas: num(l[1]), mensalidades: num(l[2]), total: num(l[3]), qtd: l[4] }; });

  var contas = valores(ss.getSheetByName(ABA.contas), 5).filter(function (l) { return l[0]; })
    .map(function (l) { return { conta: l[0], tipo: l[1], saldo: num(l[2]), limite: num(l[3]), atualizado: iso(l[4]) }; });

  var invAba = ss.getSheetByName(ABA.investimentos);
  var investimentos = valores(invAba, 15).filter(function (l) { return l[0] && num(l[5]) > 0; })
    .map(function (l) { return { ativo: l[0], instituicao: l[1], tipo: l[2], quantidade: l[3], valor: num(l[5]),
                                 codigo: l[9], aplicado: num(l[10]), lucro: num(l[11]), vencimento: iso(l[12]), taxa: l[13] }; });

  var mensalidades = valores(ss.getSheetByName(ABA.mensalidades), 6).filter(function (l) { return l[0] && l[5] === 'Sim'; })
    .map(function (l) { return { nome: l[0], valor: num(l[1]), dia: l[2], conta: l[3] }; });

  var parcelados = valores(ss.getSheetByName(ABA.parcelados), 9).filter(function (l) { return l[0] && l[8] === 'Sim'; })
    .map(function (l) { return { descricao: l[0], parcela: num(l[1]), andamento: l[5], restantes: l[6], saldo: num(l[7]) }; });

  var transacoes = valores(ss.getSheetByName(ABA.transacoes), 7)
    .filter(function (l) { return l[0] instanceof Date; })
    .sort(function (a, b) { return b[0] - a[0]; })
    .slice(0, 40)
    .map(function (l) { return { data: iso(l[0]), descricao: l[1], valor: num(l[2]), tipo: l[3], classe: l[4], categoria: l[5], conta: l[6] }; });

  var analise = null;
  var abaIA = ss.getSheetByName('Análise IA');
  var nIA = ultimaLinhaCom(abaIA, 1);
  if (nIA >= 2) {
    var a = abaIA.getRange(nIA, 1, 1, 4).getValues()[0];
    analise = { geradaEm: a[0] instanceof Date ? Utilities.formatDate(a[0], tz, "yyyy-MM-dd'T'HH:mm") : '',
                veredito: a[1], resumo: a[2], dicas: a[3] };
  }

  return {
    mes: iso(config['Mês de referência']).slice(0, 7),
    ultimaSync: config['Última sincronização'] instanceof Date ? Utilities.formatDate(config['Última sincronização'], tz, "yyyy-MM-dd'T'HH:mm") : '',
    alerta: num(config['Limite de alerta (% do disponível)']),
    resumo: resumo, categorias: categorias, faturas: faturas, contas: contas, investimentos: investimentos,
    mensalidades: mensalidades, parcelados: parcelados, transacoes: transacoes, analise: analise
  };
}
