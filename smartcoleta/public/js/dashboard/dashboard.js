// ==================================================================
// DASHBOARD | SMARTCOLETA
//
// Regra de ouro: o CÁLCULO FICA NO BANCO. Nível, situação ("sem leitura"
// inclusive), velocidade de enchimento, previsão e totais já chegam
// prontos das views (consultas C1, C3a a C3d, C4, C6, C8 e C9 do script
// src/database/tabelas_smartcoleta.sql). Este arquivo só EXIBE, FILTRA e
// ORDENA (a tabela pode ser reordenada por coluna).
//
// Hoje os dados vêm de dados-exemplo.js, que imita as mesmas consultas.
// ==================================================================


// ==================================================================
// CONFIGURAÇÃO
// ==================================================================
let CIDADE = 'Campo Novo de Rondônia';
let HORAS_EM_BREVE = 6;       // janela do indicador "Próximas 6 h" (a mesma da vw_resumo_prefeitura)
let NIVEL_MINIMO_BREVE = 50;  // só entra em "Próximas 6 h" o compartimento normal com nível acima deste % (ex.: 50)
let MAX_FILA = 5;             // quantos pontos aparecem no card de alerta
let MAX_NA_ETIQUETA = 3;      // sensores sem leitura listados na etiqueta antes do "+n"
let DIAS_DE_LEITURAS = 90;    // até quantos dias atrás o card "Leituras do dia" deixa escolher

// a view devolve a situação escrita; a página usa uma chave curta
let SITUACOES = { 'Critico': 'critico', 'Atencao': 'atencao', 'Sem leitura': 'semleitura', 'Normal': 'normal' };
let CORES = { critico: '#D64545', atencao: '#F2B705', normal: '#62C540', semleitura: '#9AA9A1' };

// tipos de resíduo: a prioridade vem do banco (tabela tipo_residuo); aqui fica
// só a cor do gráfico
let TIPOS_RESIDUO = {
	'Orgânico': { cor: '#8B5E34' },
	'Sem distinção': { cor: '#5E6B73' },
	'Reciclável': { cor: '#2F7BC1' }
};

// períodos do histórico. A API só aceita estas quatro chaves e escolhe a
// consulta pela chave (o valor da tela nunca entra no SQL)
let PERIODOS = {
	'24h': { consulta: 'C3a', horas: 24 },
	'7d': { consulta: 'C3b', horas: 7 * 24 },
	'30d': { consulta: 'C3c', horas: 30 * 24 },
	'90d': { consulta: 'C3d', horas: 90 * 24 }
};

// os indicadores ao lado do alerta. "total" vem do resumo da prefeitura (C8);
// a lista do "Ver todos" vem das linhas da C1, filtradas pelo MESMO critério
let INDICADORES = {
	critico: { filtro: function (p) { return p.situacao == 'critico'; } },
	atencao: { filtro: function (p) { return p.situacao == 'atencao'; } },
	breve: { filtro: function (p) { return p.emBreve; } },
	semleitura: { filtro: function (p) { return p.temSemLeitura; } }
};

let temGraficos = typeof Chart != 'undefined';

if (temGraficos) {
	Chart.defaults.responsive = true;
	Chart.defaults.maintainAspectRatio = false; // o gráfico ocupa a altura do card
	Chart.defaults.font.family = "'DM Sans', Arial, sans-serif";
	Chart.defaults.color = '#5E7468';
}


// ==================================================================
// ESTADO DA PÁGINA
// ==================================================================
let agora = new Date();     // hora de referência (eixos dos gráficos e limites da data)
let compartimentos = [];    // um item por compartimento (linhas da C1)
let pontos = [];            // compartimentos agrupados por ponto de coleta
let pontosPorId = {};       // pontosPorId[idPonto] = ponto
let resumo = null;          // totais da prefeitura (C8)
let linhasBairros = [];     // pontos por bairro e situação (C9)
let filtro = { busca: '', bairro: '', situacoes: [] };
let ordem = { campo: 'urgencia', sentido: 1 };
let periodoHistorico = '24h';
let pontoAberto = null;     // ponto mostrado na visão do ponto
let listaAberta = null;     // { chave, botao } do painel "Ver todos" aberto
let graficoBairros = null;
let graficoHistorico = null;


// ==================================================================
// DADOS
// Cada função devolve as linhas no MESMO formato das consultas do script.
// Hoje as linhas vêm de obterExemplo() (dados-exemplo.js). Para ligar ao
// banco, troque o corpo por um fetch() na rota da API, por exemplo:
//   fetch(`/dashboard/estado/${idPrefeitura}`).then(r => r.json())
// O resto da página não muda.
// ==================================================================
function exemplo() {
	return obterExemplo(agora, Number(document.getElementById('cenario').value));
}

// visão geral: C1 (estado de cada compartimento), C8 (resumo) e C9 (bairros)
function carregarDados() {
	let ex = exemplo();
	return { linhasEstado: ex.linhasEstado, resumo: ex.resumo, bairros: ex.bairros };
}

// visão do ponto: C4 (última coleta)
function carregarPonto(idPonto) {
	return { ultimaColeta: exemplo().ultimaColeta(idPonto) };
}

// C3a a C3d: só aceita as chaves de PERIODOS (a API faz a mesma checagem)
function carregarHistorico(idPonto, periodo) {
	if (PERIODOS[periodo] == undefined) {
		return [];
	}
	return exemplo().historico(idPonto, periodo);
}

// C6: a data precisa estar no formato AAAA-MM-DD (a API faz a mesma checagem)
function carregarLeiturasDia(idPonto, data) {
	if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
		return [];
	}
	return exemplo().leiturasDoDia(idPonto, data);
}


// ==================================================================
// PREPARAR OS DADOS: linhas do banco -> objetos da página (sem contas)
// ==================================================================
function prepararDados(dados) {
	compartimentos = [];
	pontos = [];
	pontosPorId = {};
	resumo = dados.resumo;
	linhasBairros = dados.bairros;

	for (let i = 0; i < dados.linhasEstado.length; i++) {
		let linha = dados.linhasEstado[i];
		let c = {
			idPonto: linha.idPonto, rua: linha.rua, bairro: linha.bairro,
			idCompartimento: linha.idCompartimento, tipo: linha.tipoResiduo, prioridade: Number(linha.prioridade),
			numeroSensor: linha.numeroSensor,
			limiteAtencao: Number(linha.limiteAtencao), limiteCritico: Number(linha.limiteCritico),
			dataHora: linha.dataHora ? lerData(linha.dataHora) : null,
			minutosDesdeLeitura: linha.minutosDesdeLeitura == null ? null : Number(linha.minutosDesdeLeitura),
			distanciaCm: linha.distanciaCm == null ? null : Number(linha.distanciaCm),
			nivel: linha.nivelPct == null ? null : Number(linha.nivelPct),
			situacao: SITUACOES[linha.situacao],
			peso: Number(linha.pesoSituacao),
			proximoLimite: linha.proximoLimite,
			horas: linha.horasProximoLimite == null ? null : Number(linha.horasProximoLimite)
		};
		// "Próximas 6 h": o mesmo critério da coluna compartimentosProximas6h da view
		c.emBreve = c.situacao == 'normal' && c.horas != null && c.horas <= HORAS_EM_BREVE && c.nivel >= NIVEL_MINIMO_BREVE;
		compartimentos.push(c);

		if (pontosPorId[c.idPonto] == undefined) {
			pontosPorId[c.idPonto] = { idPonto: c.idPonto, rua: c.rua, bairro: c.bairro, compartimentos: [] };
			pontos.push(pontosPorId[c.idPonto]);
		}
		pontosPorId[c.idPonto].compartimentos.push(c);
	}

	// "gatilho" = o compartimento mais urgente do ponto, entre os que têm leitura
	// (igual à vw_ponto_situacao). O ponto assume a situação dele.
	for (let i = 0; i < pontos.length; i++) {
		let ponto = pontos[i];
		let comLeitura = ponto.compartimentos.filter(function (c) { return c.situacao != 'semleitura'; });
		let ordenados = (comLeitura.length > 0 ? comLeitura : ponto.compartimentos).slice().sort(compararUrgencia);
		ponto.gatilho = ordenados[0];
		ponto.situacao = ordenados[0].situacao;
		ponto.temSemLeitura = comLeitura.length < ponto.compartimentos.length;
		ponto.emBreve = ponto.situacao == 'normal' && ponto.compartimentos.some(function (c) { return c.emBreve; });
	}
}


// ==================================================================
// REGRA DE URGÊNCIA (fila do alerta, tabela, listas e diagnóstico)
// Compara dois compartimentos nesta ordem:
//   1. situação e 2. cheio: o pesoSituacao da view já junta as duas
//      (5 cheio, 4 crítico, 3 atenção, 2 sem leitura, 1 normal)
//   3. prioridade do tipo: 1 Orgânico, 2 Sem distinção, 3 Reciclável
//   4. previsão: menos horas até o próximo limite (sem previsão vai para o fim)
//   5. nível: o mais cheio
// A prioridade só desempata dentro da mesma situação.
// ==================================================================
function compararUrgencia(a, b) {
	if (a.peso != b.peso) {
		return b.peso - a.peso;
	}
	if (a.prioridade != b.prioridade) {
		return a.prioridade - b.prioridade;
	}
	let horasA = a.horas == null ? Infinity : a.horas;
	let horasB = b.horas == null ? Infinity : b.horas;
	if (horasA != horasB) {
		return horasA - horasB;
	}
	return (b.nivel || 0) - (a.nivel || 0);
}

// Rode no console do navegador: testarUrgencia()
// Os casos imitam linhas da view (peso e prioridade como o banco devolve).
function testarUrgencia() {
	function linha(tipo, prioridade, situacao, peso, nivel, horas) {
		return { tipo: tipo, prioridade: prioridade, situacao: situacao, peso: peso, nivel: nivel, horas: horas };
	}
	let casos = [
		{ nome: 'Orgânico crítico 94% x Reciclável crítico 96%', a: linha('Orgânico', 1, 'critico', 4, 94, 2), b: linha('Reciclável', 3, 'critico', 4, 96, 1), primeiro: 'A', motivo: 'prioridade' },
		{ nome: 'Orgânico atenção 81% x Reciclável crítico 96%', a: linha('Orgânico', 1, 'atencao', 3, 81, 2), b: linha('Reciclável', 3, 'critico', 4, 96, 1), primeiro: 'B', motivo: 'situação' },
		{ nome: 'Reciclável crítico 100% x Orgânico crítico 90%', a: linha('Reciclável', 3, 'critico', 5, 100, 0), b: linha('Orgânico', 1, 'critico', 4, 90, 3), primeiro: 'A', motivo: 'cheio' },
		{ nome: 'Sem distinção atenção 72% x Reciclável atenção 80%', a: linha('Sem distinção', 2, 'atencao', 3, 72, 6), b: linha('Reciclável', 3, 'atencao', 3, 80, 4), primeiro: 'A', motivo: 'prioridade' }
	];
	let passou = 0;
	for (let i = 0; i < casos.length; i++) {
		let caso = casos[i];
		let resultado = compararUrgencia(caso.a, caso.b) < 0 ? 'A' : 'B';
		let ok = resultado == caso.primeiro;
		if (ok) passou++;
		console.log(`${ok ? '✓' : '✗'} ${caso.nome}: vem primeiro ${resultado} (esperado ${caso.primeiro}, por ${caso.motivo})`);
	}
	console.log(`${passou} de ${casos.length} casos passaram`);
	return passou == casos.length;
}


// ==================================================================
// FORMATAÇÃO (só texto e HTML; nenhuma regra de negócio)
// ==================================================================
function doisDigitos(n) {
	return n < 10 ? '0' + n : '' + n;
}

// as datas chegam como ISO (colunas DATETIME) ou 'AAAA-MM-DD HH:MM:SS' (DATE_FORMAT)
function lerData(valor) {
	let partes = /^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2}):(\d{2})$/.exec(valor);
	if (partes) {
		return new Date(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]), Number(partes[4]), Number(partes[5]), Number(partes[6]));
	}
	return new Date(valor);
}

function formatarHora(data) {
	return doisDigitos(data.getHours()) + ':' + doisDigitos(data.getMinutes());
}

function formatarDia(data) {
	return doisDigitos(data.getDate()) + '/' + doisDigitos(data.getMonth() + 1);
}

function formatarDataHora(data) {
	return formatarDia(data) + ' às ' + formatarHora(data);
}

// 'AAAA-MM-DD' da data local (valor do <input type="date">)
function dataParaCampo(data) {
	return `${data.getFullYear()}-${doisDigitos(data.getMonth() + 1)}-${doisDigitos(data.getDate())}`;
}

function formatarHaQuanto(minutos) {
	if (minutos < 1) return 'agora';
	if (minutos < 60) return `há ${Math.round(minutos)} min`;
	if (minutos < 48 * 60) return `há ${Math.round(minutos / 60)} h`;
	return `há ${Math.round(minutos / 1440)} dias`;
}

function formatarParado(minutos) {
	if (minutos == null) return 'nunca enviou leitura';
	if (minutos < 60) return `parado há ${Math.round(minutos)} min`;
	if (minutos < 48 * 60) return `parado há ${Math.round(minutos / 60)} h`;
	return `parado há ${Math.round(minutos / 1440)} dias`;
}

function formatarHoras(horas) {
	if (horas < 1) return 'menos de 1 h';
	if (horas < 48) return `~${Math.round(horas)} h`;
	return `+${Math.floor(horas / 24)} dias`;
}

function formatarNumero(valor, casas) {
	return valor.toFixed(casas).replace('.', ',');
}

// texto da previsão a partir das colunas proximoLimite e horasProximoLimite da view
function textoPrevisao(c) {
	if (c.situacao == 'semleitura') return '';
	if (c.horas == 0) return 'Cheio';
	if (c.horas == null) return '';
	return `${c.proximoLimite} em ${formatarHoras(c.horas)}`;
}

function semAcento(texto) {
	return String(texto).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

function plural(qtd, singular, varios) {
	return qtd == 1 ? singular : varios;
}

// "Av. Tancredo Neves, 120" -> "Av. Tancredo Neves" (para as frases curtas dos indicadores)
function ruaSemNumero(rua) {
	return rua.split(',')[0];
}

function mostrar(elemento, visivel) {
	elemento.toggleAttribute('hidden', !visivel);
}

function escrever(id, valor) {
	document.getElementById(id).textContent = valor;
}

function escreverEm(raiz, seletor, valor) {
	let itens = raiz.querySelectorAll(seletor);
	for (let i = 0; i < itens.length; i++) {
		itens[i].textContent = valor;
	}
}

function mostrarEstado(raiz, estado) {
	let itens = raiz.querySelectorAll('[data-estado]');
	for (let i = 0; i < itens.length; i++) {
		mostrar(itens[i], itens[i].dataset.estado.split(' ').indexOf(estado) != -1);
	}
}

function aplicarPlural(elemento, qtd) {
	elemento.textContent = plural(qtd, elemento.dataset.um, elemento.dataset.varios);
}

function aplicarTitulo(elemento, valores) {
	elemento.title = elemento.dataset.titulo.replace(/\{(\w+)\}/g, function (trecho, chave) {
		return valores[chave];
	});
}

function clonar(idModelo) {
	return document.getElementById(idModelo).content.firstElementChild.cloneNode(true);
}

function preencherTipo(raiz, tipo, prioridade) {
	raiz.querySelector('.tipo-nome').textContent = tipo;
	raiz.querySelector('.prioridade-num').textContent = prioridade;
	let ajuda = document.querySelector(`#ajuda-prioridade [data-prioridade="${prioridade}"]`);
	raiz.querySelector('.prioridade').title = ajuda ? ajuda.textContent : '';
}

function preencherBarra(barra, c) {
	aplicarTitulo(barra, { atencao: c.limiteAtencao, critico: c.limiteCritico });
	let preenchimento = barra.querySelector('.barra-preenchimento');
	preenchimento.className = 'barra-preenchimento barra-' + c.situacao;
	preenchimento.style.width = (c.nivel == null ? 0 : c.nivel) + '%';
	barra.querySelector('.barra-limite-atencao').style.left = c.limiteAtencao + '%';
	barra.querySelector('.barra-limite-critico').style.left = c.limiteCritico + '%';
}


// ==================================================================
// TOPO
// ==================================================================
function renderizarTopo() {
	escreverEm(document, '.texto-cidade', CIDADE);
	escrever('subtitulo-pontos', resumo.totalPontos);
	escrever('subtitulo-compartimentos', resumo.totalCompartimentos);

	let temLeitura = Boolean(resumo.ultimaLeitura);
	mostrar(document.getElementById('atualizacao-com'), temLeitura);
	mostrar(document.getElementById('atualizacao-sem'), !temLeitura);
	if (temLeitura) {
		escrever('atualizacao-hora', formatarHora(lerData(resumo.ultimaLeitura)));
		escrever('atualizacao-ha', formatarHaQuanto(resumo.minutosDesdeUltimaLeitura));
	}
}


// ==================================================================
// ALERTA: quais pontos coletar e em que ordem
// ==================================================================
function renderizarAlerta() {
	// fila = pontos críticos e em atenção, pelo compartimento que disparou (gatilho)
	let fila = pontos.filter(function (p) { return p.situacao == 'critico' || p.situacao == 'atencao'; });
	fila.sort(function (a, b) { return compararUrgencia(a.gatilho, b.gatilho); });

	let card = document.getElementById('alerta');
	let estado = resumo.pontosCriticos > 0 ? 'critico' : resumo.pontosAtencao > 0 ? 'atencao' : 'normal';
	let total = estado == 'normal' ? 0 : resumo.pontosParaColetar;

	card.className = 'card alerta alerta-' + estado;
	mostrarEstado(card, estado);
	mostrar(document.getElementById('alerta-rotulo'), true);
	escrever('alerta-numero', total);
	aplicarPlural(document.getElementById('alerta-palavra-coletar'), total);
	aplicarPlural(document.getElementById('alerta-palavra-atencao'), total);
	escrever('alerta-qtd-criticos', resumo.pontosCriticos);
	aplicarPlural(document.getElementById('alerta-palavra-criticos'), resumo.pontosCriticos);
	escrever('alerta-qtd-atencao', resumo.pontosAtencao);
	mostrar(document.getElementById('alerta-texto-atencao'), resumo.pontosAtencao > 0);

	// lista: se não há ponto em alerta, mostra os próximos a entrar em atenção
	let lista = fila;
	let proximos = fila.length == 0;
	if (proximos) {
		lista = pontos.filter(function (p) { return p.gatilho.horas != null; })
			.sort(function (a, b) { return a.gatilho.horas - b.gatilho.horas; });
	}
	mostrar(document.getElementById('fila-legenda-alerta'), !proximos);
	mostrar(document.getElementById('fila-legenda-proximos'), proximos);

	let ol = document.getElementById('fila');
	ol.replaceChildren();
	let qtdNaFila = Math.min(lista.length, MAX_FILA);
	for (let i = 0; i < qtdNaFila; i++) {
		let ponto = lista[i];
		let g = ponto.gatilho;
		let item = clonar('modelo-fila');
		let botao = item.querySelector('.fila-item');
		botao.classList.add('fila-item-' + ponto.situacao);
		botao.onclick = function () { abrirPonto(ponto.idPonto); };
		aplicarTitulo(botao, { rua: ponto.rua });
		item.querySelector('.fila-posicao').textContent = i + 1;
		item.querySelector('.fila-rua').textContent = ponto.rua;
		item.querySelector('.fila-bairro').textContent = ponto.bairro;
		preencherTipo(item.querySelector('.fila-motivo'), g.tipo, g.prioridade);
		item.querySelector('.fila-nivel').textContent = Math.round(g.nivel);
		item.querySelector('.fila-previsao').textContent = textoPrevisao(g);
		ol.appendChild(item);
	}

}

// ==================================================================
// INDICADORES (coluna ao lado do alerta) e painel "Ver todos"
// ==================================================================

// sensores de um indicador, do mais urgente para o menos urgente
function listaDoIndicador(chave) {
	return pontos.filter(INDICADORES[chave].filtro).sort(function (a, b) {
		return compararUrgencia(a.gatilho, b.gatilho);
	});
}

// o compartimento que explica a presença do ponto no indicador
function compartimentoCitado(chave, ponto) {
	let teste = null;
	if (chave == 'semleitura') teste = function (c) { return c.situacao == 'semleitura'; };
	if (chave == 'breve') teste = function (c) { return c.emBreve; };
	if (teste == null) return ponto.gatilho;
	return ponto.compartimentos.filter(teste).sort(compararUrgencia)[0];
}

// cada indicador tem 3 linhas: título e "Ver todos" | quantidade de PONTOS | ponto citado
function renderizarIndicador(chave) {
	let lista = listaDoIndicador(chave);
	let total = lista.length;
	let caixa = document.getElementById('indicador-' + chave);

	let botao = caixa.querySelector('.ver-todos');
	mostrar(botao, total != 0);
	botao.setAttribute('aria-expanded', 'false');
	caixa.querySelector('.ver-todos-qtd').textContent = total;
	caixa.querySelector('.indicador-dado').textContent = total;
	aplicarPlural(caixa.querySelector('.indicador-unidade'), total);

	if (chave == 'breve') {
		escrever('breve-pct', NIVEL_MINIMO_BREVE);
	}
	if (chave == 'semleitura') {
		mostrar(document.getElementById('semleitura-etiqueta'), total > 0);
		if (total > 0) {
			let ids = lista.slice(0, MAX_NA_ETIQUETA).map(function (p) { return p.idPonto; }).join(', ');
			let resto = lista.length > MAX_NA_ETIQUETA ? ` +${lista.length - MAX_NA_ETIQUETA}` : '';
			escrever('semleitura-numeros', ids + resto);
		}
		escrever('pct-com-leitura', pontos.length == 0 ? 0 : Math.round((pontos.length - total) / pontos.length * 100));
	}

	let citado = caixa.querySelector('.citado');
	mostrar(citado, total != 0);
	mostrar(caixa.querySelector('.indicador-vazio'), total == 0);
	if (total != 0) {
		let p = lista[0];
		let c = compartimentoCitado(chave, p);
		let semLeitura = c.situacao == 'semleitura';
		citado.querySelector('.citado-rua').textContent = ruaSemNumero(p.rua);
		citado.querySelector('.citado-bairro').textContent = p.bairro;
		mostrar(citado.querySelector('.citado-leitura'), !semLeitura);
		mostrar(citado.querySelector('.citado-parado'), semLeitura);
		if (semLeitura) {
			citado.querySelector('.citado-parado').textContent = formatarParado(c.minutosDesdeLeitura);
		} else {
			citado.querySelector('.citado-tipo').textContent = c.tipo;
			citado.querySelector('.citado-nivel').textContent = Math.round(c.nivel);
		}
		citado.title = citado.innerText;
	}
}

function renderizarIndicadores() {
	fecharLista();
	let chaves = Object.keys(INDICADORES);
	for (let i = 0; i < chaves.length; i++) {
		renderizarIndicador(chaves[i]);
	}
}

// abre o painel com a lista completa; clicar de novo no mesmo botão fecha
function alternarLista(chave, botao) {
	if (listaAberta && listaAberta.chave == chave) {
		fecharLista();
		return;
	}
	fecharLista();
	let lista = listaDoIndicador(chave);

	let ul = document.getElementById('painel-lista-itens');
	ul.replaceChildren();
	for (let i = 0; i < lista.length; i++) {
		let p = lista[i];
		let c = compartimentoCitado(chave, p);
		let item = clonar('modelo-lista-item');
		let semLeitura = c.situacao == 'semleitura';
		let previsao = textoPrevisao(c);
		item.querySelector('.lista-item').onclick = function () { abrirPontoDaLista(c.idPonto); };
		item.querySelector('.lista-sensor-num').textContent = p.idPonto;
		item.querySelector('.lista-rua').textContent = p.rua;
		item.querySelector('.lista-bairro').textContent = p.bairro;
		preencherTipo(item.querySelector('.lista-tipo'), c.tipo, c.prioridade);
		mostrar(item.querySelector('.lista-parado'), semLeitura);
		mostrar(item.querySelector('.lista-com-leitura'), !semLeitura);
		if (semLeitura) {
			item.querySelector('.lista-parado').textContent = formatarParado(c.minutosDesdeLeitura);
		} else {
			item.querySelector('.lista-nivel').classList.add('nivel-' + c.situacao);
			item.querySelector('.lista-nivel-valor').textContent = Math.round(c.nivel);
			mostrar(item.querySelector('.lista-previsao-caixa'), previsao != '');
			item.querySelector('.lista-previsao').textContent = previsao;
		}
		ul.appendChild(item);
	}
	mostrarEstado(document.getElementById('painel-lista-titulo'), chave);
	escrever('lista-breve-pct', NIVEL_MINIMO_BREVE);
	escrever('painel-lista-qtd', lista.length);

	let painel = document.getElementById('painel-lista');
	painel.hidden = false;
	listaAberta = { chave: chave, botao: botao };
	botao.setAttribute('aria-expanded', 'true');
	posicionarLista(botao);
	painel.querySelector('.painel-lista-fechar').focus();
}

// popover ao lado do card (à esquerda, onde há espaço); em tela pequena, modal centralizado
function posicionarLista(botao) {
	let painel = document.getElementById('painel-lista');
	let fundo = document.getElementById('painel-lista-fundo');
	let modal = window.innerWidth < 720;
	painel.classList.toggle('painel-lista-modal', modal);
	fundo.hidden = !modal;
	if (modal) {
		painel.style.left = '';
		painel.style.top = '';
		return;
	}
	let card = botao.closest('.indicador').getBoundingClientRect();
	let largura = painel.offsetWidth;
	let altura = painel.offsetHeight;
	let esquerda = card.left - largura - 12;
	if (esquerda < 8) {
		esquerda = Math.max(8, card.right - largura);
	}
	let topo = Math.min(Math.max(8, card.top), window.innerHeight - altura - 8);
	painel.style.left = esquerda + 'px';
	painel.style.top = Math.max(8, topo) + 'px';
}

function fecharLista() {
	if (listaAberta == null) return;
	let botao = listaAberta.botao;
	listaAberta = null;
	document.getElementById('painel-lista').hidden = true;
	document.getElementById('painel-lista-fundo').hidden = true;
	if (botao && document.body.contains(botao)) {
		botao.setAttribute('aria-expanded', 'false');
		botao.focus();
	}
}

function abrirPontoDaLista(idPonto) {
	fecharLista();
	abrirPonto(idPonto);
}

// o painel fecha com Esc e com clique fora dele
document.addEventListener('keydown', function (evento) {
	if (evento.key == 'Escape' && listaAberta) {
		fecharLista();
	}
});
document.addEventListener('mousedown', function (evento) {
	if (listaAberta == null) return;
	let painel = document.getElementById('painel-lista');
	if (!painel.contains(evento.target) && !listaAberta.botao.contains(evento.target)) {
		fecharLista();
	}
});
window.addEventListener('resize', function () {
	if (listaAberta) posicionarLista(listaAberta.botao);
});


// ==================================================================
// CONSULTA: select de ponto de coleta e select de compartimento
// (no lugar da antiga tabela "Todos os compartimentos")
// ==================================================================
function renderizarConsulta() {
	let select = document.getElementById('select-ponto');
	let anterior = select.value;
	select.replaceChildren(new Option('Escolha um ponto de coleta', ''));
	let lista = pontos
		.filter(function (p) { return filtro.bairro == '' || p.bairro == filtro.bairro; })
		.sort(function (a, b) { return a.rua.localeCompare(b.rua, 'pt-BR'); });
	for (let i = 0; i < lista.length; i++) {
		select.add(new Option(`${lista[i].rua} · ${lista[i].bairro}`, lista[i].idPonto));
	}
	select.value = anterior;
	if (select.selectedIndex < 0) select.selectedIndex = 0;

	mostrar(document.getElementById('consulta-bairro'), filtro.bairro != '');
	escrever('consulta-bairro-nome', filtro.bairro);
	aoEscolherPonto();
}

function aoEscolherPonto() {
	let ponto = pontosPorId[document.getElementById('select-ponto').value];
	let select = document.getElementById('select-compartimento');
	let anterior = select.value;
	select.replaceChildren(new Option('Todos os compartimentos do ponto', ''));
	if (ponto != undefined) {
		for (let i = 0; i < ponto.compartimentos.length; i++) {
			let c = ponto.compartimentos[i];
			select.add(new Option(`${c.tipo} (P${c.prioridade}) · sensor ${c.numeroSensor}`, c.idCompartimento));
		}
	}
	select.disabled = ponto == undefined;
	select.value = anterior;
	if (select.selectedIndex < 0) select.selectedIndex = 0;
	renderizarConsultaResultado();
}

function renderizarConsultaResultado() {
	let ponto = pontosPorId[document.getElementById('select-ponto').value];
	let idCompartimento = document.getElementById('select-compartimento').value;
	let caixa = document.getElementById('consulta-resultado');
	caixa.replaceChildren();
	mostrar(document.getElementById('consulta-vazia'), ponto == undefined);
	mostrar(document.getElementById('consulta-abrir'), ponto != undefined);
	if (ponto == undefined) return;

	let itens = ponto.compartimentos
		.filter(function (c) { return idCompartimento == '' || String(c.idCompartimento) == idCompartimento; })
		.sort(compararUrgencia);
	for (let i = 0; i < itens.length; i++) {
		let c = itens[i];
		let item = clonar('modelo-consulta');
		let selo = item.querySelector('.situacao');
		selo.classList.add('situacao-' + c.situacao);
		mostrarEstado(selo, c.situacao);
		preencherTipo(item, c.tipo, c.prioridade);
		item.querySelector('.sensor-num-valor').textContent = c.numeroSensor;
		preencherBarra(item.querySelector('.barra'), c);
		item.querySelector('.nivel-texto').textContent = c.nivel == null ? '—' : Math.round(c.nivel) + '%';
		item.querySelector('.col-previsao').textContent = textoPrevisao(c) || '—';
		item.querySelector('.leitura-ha').textContent = c.dataHora ? formatarHaQuanto(c.minutosDesdeLeitura) : 'nunca';
		item.querySelector('.lim-atencao').textContent = c.limiteAtencao;
		item.querySelector('.lim-critico').textContent = c.limiteCritico;
		caixa.appendChild(item);
	}
}

function abrirPontoSelecionado() {
	abrirPonto(Number(document.getElementById('select-ponto').value));
}

function limparBairro() {
	filtro.bairro = '';
	renderizarConsulta();
	atualizarGraficoBairros();
}


// ==================================================================
// TELA DE BAIRROS: todos os bairros, com a situação dos pontos de cada um
// ==================================================================
function resumoDosBairros() {
	let mapa = {};
	for (let i = 0; i < pontos.length; i++) {
		let p = pontos[i];
		if (mapa[p.bairro] == undefined) {
			mapa[p.bairro] = { bairro: p.bairro, pontos: 0, compartimentos: 0, criticos: 0, atencao: 0, normais: 0, semLeitura: 0, somaNivel: 0, qtdNivel: 0 };
		}
		let b = mapa[p.bairro];
		b.pontos++;
		b.compartimentos += p.compartimentos.length;
		if (p.situacao == 'critico') b.criticos++;
		if (p.situacao == 'atencao') b.atencao++;
		if (p.situacao == 'normal') b.normais++;
		if (p.temSemLeitura) b.semLeitura++;
		for (let k = 0; k < p.compartimentos.length; k++) {
			if (p.compartimentos[k].nivel != null) {
				b.somaNivel += p.compartimentos[k].nivel;
				b.qtdNivel++;
			}
		}
	}
	return Object.values(mapa).sort(function (a, b) {
		return (b.criticos - a.criticos) || (b.atencao - a.atencao) || a.bairro.localeCompare(b.bairro, 'pt-BR');
	});
}

function renderizarBairros() {
	let lista = resumoDosBairros();
	escrever('bairros-qtd', lista.length);
	let corpo = document.getElementById('bairros-corpo');
	corpo.replaceChildren();
	for (let i = 0; i < lista.length; i++) {
		let b = lista[i];
		let linha = document.createElement('tr');
		linha.tabIndex = 0;
		linha.title = 'Consultar os pontos de ' + b.bairro;
		linha.onclick = function () { escolherBairro(b.bairro); };
		linha.onkeydown = function (evento) { if (evento.key == 'Enter') escolherBairro(b.bairro); };
		let media = b.qtdNivel == 0 ? '—' : Math.round(b.somaNivel / b.qtdNivel) + '%';
		let celulas = [
			[b.bairro, 'bairros-nome'], [b.pontos, ''], [b.compartimentos, ''],
			[b.criticos, b.criticos > 0 ? 'bairros-critico' : 'bairros-zero'],
			[b.atencao, b.atencao > 0 ? 'bairros-atencao' : 'bairros-zero'],
			[b.normais, ''],
			[b.semLeitura, b.semLeitura > 0 ? 'bairros-semleitura' : 'bairros-zero'],
			[media, '']
		];
		for (let k = 0; k < celulas.length; k++) {
			let td = document.createElement('td');
			td.textContent = celulas[k][0];
			td.className = celulas[k][1];
			linha.appendChild(td);
		}
		corpo.appendChild(linha);
	}
}

function marcarMenu(ativo) {
	document.getElementById('link-dashboard').classList.toggle('barra-link-ativo', ativo == 'dashboard');
	document.getElementById('link-bairros').classList.toggle('barra-link-ativo', ativo == 'bairros');
}

function abrirBairros() {
	pontoAberto = null;
	fecharLista();
	document.getElementById('visao-geral').hidden = true;
	document.getElementById('visao-ponto').hidden = true;
	document.getElementById('visao-bairros').hidden = false;
	document.getElementById('botao-voltar').hidden = false;
	document.getElementById('titulo-geral').hidden = false;
	document.getElementById('titulo-ponto').hidden = true;
	document.getElementById('subtitulo-geral').hidden = false;
	document.getElementById('subtitulo-ponto').hidden = true;
	marcarMenu('bairros');
	window.scrollTo(0, 0);
}

// clicar num bairro volta para a visão geral e já filtra a consulta e o gráfico por ele
function escolherBairro(nome) {
	filtro.bairro = nome;
	voltarVisaoGeral();
	renderizarConsulta();
	atualizarGraficoBairros();
	document.getElementById('card-consulta').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}


// ==================================================================
// EXPORTAR CSV e REPORTAR BUG (botões do topo)
// ==================================================================
function celulaCSV(valor) {
	let texto = valor == null ? '' : String(valor);
	return /[;"\n\r]/.test(texto) ? '"' + texto.replace(/"/g, '""') + '"' : texto;
}

// exporta os compartimentos (respeitando o bairro filtrado). Separador ";" e vírgula
// decimal: o Excel em português abre direto, e o BOM (\ufeff) mantém os acentos
function exportarCSV() {
	let nomes = { critico: 'Crítico', atencao: 'Atenção', semleitura: 'Sem leitura', normal: 'Normal' };
	let linhas = [['Ponto de coleta', 'Rua', 'Bairro', 'Compartimento', 'Tipo de resíduo', 'Prioridade', 'Sensor', 'Nível (%)', 'Situação', 'Limite de atenção (%)', 'Limite crítico (%)', 'Previsão', 'Última leitura']];
	let lista = compartimentos.filter(function (c) { return filtro.bairro == '' || c.bairro == filtro.bairro; });
	for (let i = 0; i < lista.length; i++) {
		let c = lista[i];
		linhas.push([
			c.idPonto, c.rua, c.bairro, c.idCompartimento, c.tipo, c.prioridade, c.numeroSensor,
			c.nivel == null ? '' : String(Math.round(c.nivel * 10) / 10).replace('.', ','),
			nomes[c.situacao], c.limiteAtencao, c.limiteCritico, textoPrevisao(c),
			c.dataHora ? formatarDataHora(c.dataHora) : ''
		]);
	}
	let texto = linhas.map(function (l) { return l.map(celulaCSV).join(';'); }).join('\r\n');
	let arquivo = new Blob(['\ufeff' + texto], { type: 'text/csv;charset=utf-8;' });
	let link = document.createElement('a');
	link.href = URL.createObjectURL(arquivo);
	link.download = 'smartcoleta_compartimentos_' + dataParaCampo(new Date()) + '.csv';
	document.body.appendChild(link);
	link.click();
	link.remove();
	URL.revokeObjectURL(link.href);
}

// abre o e-mail já preenchido com a página, a data e o navegador
function reportarBug() {
	let corpo = 'Descreva o problema:\n\n\n\n---\nPágina: ' + location.href +
		'\nData e hora: ' + new Date().toLocaleString('pt-BR') +
		'\nNavegador: ' + navigator.userAgent;
	location.href = 'mailto:contato@smartcoleta.com.br?subject=' + encodeURIComponent('[Bug] Dashboard SmartColeta') +
		'&body=' + encodeURIComponent(corpo);
}


// ==================================================================
// GRÁFICO: PONTOS POR BAIRRO (barras horizontais empilhadas, consulta C9)
// ==================================================================
function atualizarGraficoBairros() {
	if (!temGraficos) return;
	// as linhas da C9 já vêm na ordem: mais críticos e em atenção primeiro
	let nomes = linhasBairros.map(function (b) { return b.bairro; });

	// o bairro filtrado fica destacado; os outros, mais claros
	function cor(base, nome) {
		return filtro.bairro == '' || filtro.bairro == nome ? base : base + '55';
	}
	let dados = {
		labels: nomes,
		datasets: [
			{ label: 'Crítico', corBase: CORES.critico, data: linhasBairros.map(function (b) { return Number(b.pontosCriticos); }), backgroundColor: nomes.map(function (n) { return cor(CORES.critico, n); }) },
			{ label: 'Atenção', corBase: CORES.atencao, data: linhasBairros.map(function (b) { return Number(b.pontosAtencao); }), backgroundColor: nomes.map(function (n) { return cor(CORES.atencao, n); }) },
			{ label: 'Normal', corBase: '#B9E3A8', data: linhasBairros.map(function (b) { return Number(b.pontosNormais); }), backgroundColor: nomes.map(function (n) { return cor('#B9E3A8', n); }) }
		]
	};

	if (graficoBairros == null) {
		graficoBairros = new Chart(document.getElementById('graficoBairros'), {
			type: 'bar',
			data: dados,
			options: {
				indexAxis: 'y', // barras deitadas: nomes de bairro longos cabem
				datasets: { bar: { borderRadius: 3, maxBarThickness: 22, borderSkipped: false, borderWidth: 1, borderColor: '#fff' } },
				plugins: {
					legend: {
						position: 'bottom',
						labels: {
							boxWidth: 10, boxHeight: 10, font: { size: 11 },
							// a legenda usa a cor cheia, mesmo com um bairro filtrado (barras claras)
							generateLabels: function (chart) {
								return chart.data.datasets.map(function (d, i) {
									return { text: d.label, fillStyle: d.corBase, strokeStyle: d.corBase, lineWidth: 0, hidden: !chart.isDatasetVisible(i), datasetIndex: i, fontColor: '#5E7468' };
								});
							}
						}
					},
					tooltip: { callbacks: { label: function (ctx) { return ` ${ctx.dataset.label}: ${ctx.raw} ${plural(ctx.raw, 'ponto', 'pontos')}`; } } }
				},
				scales: {
					x: { stacked: true, beginAtZero: true, ticks: { precision: 0 }, grid: { color: '#EEF3F0' } },
					y: { stacked: true, grid: { display: false }, ticks: { autoSkip: false, font: { size: 11 } } }
				},
				onClick: function (evento, itens) {
					if (itens.length == 0) return;
					let nome = linhasBairros[itens[0].index].bairro;
					filtro.bairro = filtro.bairro == nome ? '' : nome; // clicar de novo tira o filtro
					renderizarConsulta();
					atualizarGraficoBairros();
				},
				onHover: function (evento, itens) {
					evento.native.target.style.cursor = itens.length > 0 ? 'pointer' : 'default';
				}
			}
		});
	} else {
		graficoBairros.data = dados;
		graficoBairros.update();
	}
}


// ==================================================================
// VISÃO DE UM PONTO
// ==================================================================
function abrirPonto(idPonto) {
	let ponto = pontosPorId[idPonto];
	if (ponto == undefined) return;
	pontoAberto = ponto;
	fecharLista();

	let dadosPonto = carregarPonto(idPonto);

	document.getElementById('visao-geral').hidden = true;
	document.getElementById('visao-bairros').hidden = true;
	document.getElementById('visao-ponto').hidden = false;
	marcarMenu('dashboard');
	document.getElementById('botao-voltar').hidden = false;
	document.getElementById('titulo-geral').hidden = true;
	document.getElementById('titulo-ponto').hidden = false;
	document.getElementById('subtitulo-geral').hidden = true;
	document.getElementById('subtitulo-ponto').hidden = false;
	escrever('titulo-rua', ponto.rua);
	escrever('titulo-bairro', ponto.bairro);
	escrever('subtitulo-id-ponto', ponto.idPonto);
	escrever('subtitulo-qtd-ponto', ponto.compartimentos.length);
	window.scrollTo(0, 0);

	renderizarDiagnostico(ponto);
	renderizarUltimaColeta(dadosPonto.ultimaColeta);
	renderizarSeletorPeriodo();
	renderizarHistorico();
	prepararCampoData();
	renderizarLeiturasDia();
}

function voltarVisaoGeral() {
	pontoAberto = null;
	document.getElementById('visao-ponto').hidden = true;
	document.getElementById('visao-bairros').hidden = true;
	document.getElementById('visao-geral').hidden = false;
	marcarMenu('dashboard');
	document.getElementById('botao-voltar').hidden = true;
	document.getElementById('titulo-geral').hidden = false;
	document.getElementById('titulo-ponto').hidden = true;
	document.getElementById('subtitulo-geral').hidden = false;
	document.getElementById('subtitulo-ponto').hidden = true;
	renderizarTopo();
}

// DIAGNÓSTICO: o que fazer com este ponto e por quê
function renderizarDiagnostico(ponto) {
	let card = document.getElementById('diagnostico');
	let g = ponto.gatilho;
	let previsao = textoPrevisao(g);

	card.className = 'card alerta diagnostico alerta-' + ponto.situacao;
	mostrarEstado(card, ponto.situacao);
	escreverEm(card, '.diag-gatilho-tipo', g.tipo);
	escreverEm(card, '.diag-gatilho-nivel', g.nivel == null ? '' : Math.round(g.nivel));
	escreverEm(card, '.diag-limite-critico', g.limiteCritico);
	escreverEm(card, '.diag-limite-atencao', g.limiteAtencao);
	escreverEm(card, '.diag-previsao', previsao);
	escreverEm(card, '.diag-qtd', ponto.compartimentos.length);
	mostrar(card.querySelector('.diag-fica'), previsao != '' && previsao != 'Cheio');
	mostrar(card.querySelector('.diag-chega'), previsao != '');
	mostrar(card.querySelector('.diag-com-previsao'), previsao != '');
	mostrar(card.querySelector('.diag-sem-previsao'), previsao == '');
	mostrar(document.getElementById('diag-aviso-semleitura'), ponto.temSemLeitura && ponto.situacao != 'semleitura');

	// um compartimento por linha, do mais urgente para o menos urgente
	let lista = ponto.compartimentos.slice().sort(compararUrgencia);
	let ul = document.getElementById('diag-lista');
	ul.replaceChildren();
	for (let i = 0; i < lista.length; i++) {
		let c = lista[i];
		let item = clonar('modelo-diag-item');
		let semLeitura = c.situacao == 'semleitura';
		let previsaoItem = textoPrevisao(c);
		preencherTipo(item.querySelector('.diag-tipo'), c.tipo, c.prioridade);
		preencherBarra(item.querySelector('.barra'), c);
		let nivel = item.querySelector('.diag-nivel');
		nivel.classList.add('nivel-' + c.situacao);
		nivel.textContent = c.nivel == null ? '—' : Math.round(c.nivel) + '%';
		mostrar(item.querySelector('.diag-detalhe-semleitura'), semLeitura);
		mostrar(item.querySelector('.diag-detalhe-leitura'), !semLeitura);
		item.querySelector('.diag-sensor').textContent = c.numeroSensor;
		item.querySelector('.diag-parado').textContent = formatarParado(c.minutosDesdeLeitura);
		mostrar(item.querySelector('.diag-previsao-caixa'), previsaoItem != '');
		item.querySelector('.diag-previsao-item').textContent = previsaoItem;
		item.querySelector('.diag-lim-atencao').textContent = c.limiteAtencao;
		item.querySelector('.diag-lim-critico').textContent = c.limiteCritico;
		ul.appendChild(item);
	}
}

// ÚLTIMA COLETA: nível de cada compartimento na hora da coleta (C4, tabela N:M)
function renderizarUltimaColeta(linhas) {
	let temColeta = linhas.length > 0;
	let nota = document.getElementById('coleta-nota');
	let ul = document.getElementById('coleta-itens');
	mostrar(document.getElementById('coleta-data'), temColeta);
	mostrar(document.getElementById('coleta-nenhuma'), !temColeta);
	mostrar(document.getElementById('coleta-ha-caixa'), temColeta);
	mostrar(document.getElementById('coleta-sem'), !temColeta);
	mostrar(nota, temColeta);
	ul.replaceChildren();
	if (!temColeta) return;

	escrever('coleta-data', formatarDataHora(lerData(linhas[0].dataHoraColeta)));
	escrever('coleta-ha', formatarHaQuanto(Number(linhas[0].minutosDesdeColeta)));

	let tarde = false;
	for (let i = 0; i < linhas.length; i++) {
		let l = linhas[i];
		let situacao = SITUACOES[l.situacaoNaColeta];
		if (situacao == 'critico') tarde = true;
		let item = clonar('modelo-coleta-item');
		preencherTipo(item, l.tipoResiduo, l.prioridade);
		item.querySelector('strong').className = 'nivel-' + situacao;
		item.querySelector('.coleta-nivel').textContent = Math.round(Number(l.percentualAntes));
		ul.appendChild(item);
	}
	nota.className = tarde ? 'coleta-nota coleta-nota-tarde' : 'coleta-nota';
	mostrar(document.getElementById('coleta-nota-tarde'), tarde);
	mostrar(document.getElementById('coleta-nota-ok'), !tarde);
}


// ---------- HISTÓRICO POR COMPARTIMENTO (consultas C3a a C3d) ----------

// botões 24 h | 7 dias | 30 dias | 90 dias
function renderizarSeletorPeriodo() {
	let botoes = document.querySelectorAll('#seletor-periodo button');
	for (let i = 0; i < botoes.length; i++) {
		let ativo = botoes[i].dataset.periodo == periodoHistorico;
		botoes[i].classList.toggle('ativo', ativo);
		botoes[i].setAttribute('aria-pressed', ativo);
	}
	mostrarEstado(document.getElementById('historico-subtitulo'), periodoHistorico);
}

function escolherPeriodo(chave) {
	if (PERIODOS[chave] == undefined || pontoAberto == null) return;
	periodoHistorico = chave;
	renderizarSeletorPeriodo();
	renderizarHistorico();
}

// início do eixo X: 24 h, 7 e 30 dias contam a partir de agora; 90 dias, a partir da meia-noite (como a C3d)
function inicioDoPeriodo(chave) {
	if (chave == '90d') {
		return new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - 89).getTime();
	}
	return agora.getTime() - PERIODOS[chave].horas * 3600000;
}

// marcas do eixo X em horários "redondos": de 3 em 3 h (24 h) ou à meia-noite
function marcasDoEixo(chave, minimo, maximo) {
	let marcas = [];
	if (chave == '24h') {
		let d = new Date(minimo);
		d.setMinutes(0, 0, 0);
		d.setHours(Math.ceil(d.getHours() / 3) * 3);
		for (; d.getTime() <= maximo; d.setHours(d.getHours() + 3)) {
			if (d.getTime() >= minimo) marcas.push({ value: d.getTime() });
		}
		return marcas;
	}
	let passoDias = chave == '7d' ? 1 : chave == '30d' ? 5 : 15;
	let d = new Date(maximo);
	d.setHours(0, 0, 0, 0);
	for (; d.getTime() >= minimo; d.setDate(d.getDate() - passoDias)) {
		marcas.unshift({ value: d.getTime() });
	}
	return marcas;
}

// título do tooltip: data e hora (ou o intervalo que o ponto representa)
function tituloDoIntervalo(chave, inicio) {
	let d = new Date(inicio);
	if (chave == '24h') return formatarDataHora(d);
	if (chave == '7d') return `${formatarDataHora(d)} · maior nível da hora`;
	if (chave == '30d') {
		let fim = new Date(inicio + 6 * 3600000);
		return `${formatarDia(d)}, ${doisDigitos(d.getHours())}h às ${doisDigitos(fim.getHours())}h · maior nível do bloco`;
	}
	return `${formatarDia(d)} · máximo do dia`;
}

// tooltip com TODOS os compartimentos no horário apontado: acha o ponto mais
// próximo e junta o ponto de cada linha com o mesmo horário (até meio intervalo)
if (temGraficos) {
	Chart.Interaction.modes.mesmoHorario = function (chart, evento, opcoes, usarFinal) {
		let maisProximo = Chart.Interaction.modes.nearest(chart, evento, { axis: 'x', intersect: false }, usarFinal);
		if (maisProximo.length == 0) return [];
		let x = maisProximo[0].element.x;
		let tolerancia = 4;
		let itens = [];
		chart.data.datasets.forEach(function (conjunto, indice) {
			let meta = chart.getDatasetMeta(indice);
			if (meta.hidden) return;
			let melhor = null;
			meta.data.forEach(function (elemento, j) {
				let distancia = Math.abs(elemento.x - x);
				if (distancia <= tolerancia && (melhor == null || distancia < melhor.distancia)) {
					melhor = { element: elemento, datasetIndex: indice, index: j, distancia: distancia };
				}
			});
			if (melhor) itens.push(melhor);
		});
		return itens;
	};
}

function renderizarHistorico() {
	if (!temGraficos) return;
	let ponto = pontoAberto;
	let chave = periodoHistorico;
	let linhas = carregarHistorico(ponto.idPonto, chave);

	// uma linha (dataset) por compartimento, na ordem de prioridade
	let porCompartimento = ponto.compartimentos.slice().sort(function (a, b) { return a.prioridade - b.prioridade; });
	let datasets = [];
	for (let i = 0; i < porCompartimento.length; i++) {
		let c = porCompartimento[i];
		let pontosLinha = [];
		for (let j = 0; j < linhas.length; j++) {
			if (linhas[j].idCompartimento == c.idCompartimento) {
				pontosLinha.push({ x: lerData(linhas[j].inicioIntervalo).getTime(), y: Number(linhas[j].nivelPct) });
			}
		}
		let cor = TIPOS_RESIDUO[c.tipo] ? TIPOS_RESIDUO[c.tipo].cor : '#00472A';
		datasets.push({
			label: `${c.tipo} P${c.prioridade} (sensor ${c.numeroSensor})`,
			data: pontosLinha,
			borderColor: cor, backgroundColor: cor,
			borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, tension: chave == '24h' ? 0.25 : 0,
			limiteAtencao: c.limiteAtencao, limiteCritico: c.limiteCritico // usados no tooltip
		});
	}

	let minimo = inicioDoPeriodo(chave);
	let maximo = agora.getTime();

	if (graficoHistorico == null) {
		graficoHistorico = new Chart(document.getElementById('graficoHistorico'), {
			type: 'line',
			data: { datasets: datasets },
			options: {
				parsing: false,
				animation: false,
				interaction: { mode: 'mesmoHorario', intersect: false },
				plugins: {
					legend: { position: 'bottom', labels: { boxWidth: 12, boxHeight: 3, font: { size: 11 } } },
					tooltip: {
						callbacks: {
							title: function (itens) { return tituloDoIntervalo(periodoHistorico, itens[0].parsed.x); },
							label: function (item) {
								let d = item.dataset;
								return ` ${d.label}: ${formatarNumero(item.parsed.y, 1)}% (atenção ${d.limiteAtencao}%, crítico ${d.limiteCritico}%)`;
							}
						}
					}
				},
				scales: {
					x: {
						type: 'linear', min: minimo, max: maximo,
						afterBuildTicks: function (eixo) { eixo.ticks = marcasDoEixo(periodoHistorico, eixo.min, eixo.max); },
						ticks: {
							autoSkip: true, autoSkipPadding: 12, maxRotation: 0, // em tela estreita, esconde as marcas que não cabem
							callback: function (valor) {
								let d = new Date(valor);
								return periodoHistorico == '24h' ? formatarHora(d) : formatarDia(d);
							}
						},
						grid: { display: false }
					},
					y: { min: 0, max: 100, ticks: { stepSize: 25, callback: function (valor) { return valor + '%'; } }, grid: { color: '#EEF3F0' } }
				}
			}
		});
	} else {
		graficoHistorico.data.datasets = datasets;
		graficoHistorico.options.scales.x.min = minimo;
		graficoHistorico.options.scales.x.max = maximo;
		graficoHistorico.update();
	}
}


// ---------- LEITURAS DO DIA (consulta C6) ----------

// o campo de data começa em hoje e aceita até 90 dias atrás
function prepararCampoData() {
	let campo = document.getElementById('leituras-data');
	let minimo = new Date(agora.getFullYear(), agora.getMonth(), agora.getDate() - DIAS_DE_LEITURAS);
	campo.min = dataParaCampo(minimo);
	campo.max = dataParaCampo(agora);
	campo.value = campo.max;
}

function aoEscolherData() {
	let campo = document.getElementById('leituras-data');
	// data fora do intervalo ou vazia (o teclado deixa digitar): volta para hoje
	if (!/^\d{4}-\d{2}-\d{2}$/.test(campo.value) || campo.value < campo.min || campo.value > campo.max) {
		campo.value = campo.max;
	}
	renderizarLeiturasDia();
}

function renderizarLeiturasDia() {
	let data = document.getElementById('leituras-data').value;
	let linhas = carregarLeiturasDia(pontoAberto.idPonto, data);
	let partes = data.split('-');
	escreverEm(document, '.leituras-dia', `${partes[2]}/${partes[1]}`);

	let corpo = document.getElementById('leituras-corpo');
	corpo.replaceChildren();
	for (let i = 0; i < linhas.length; i++) {
		let l = linhas[i];
		let linha = clonar('modelo-leitura');
		linha.querySelector('.leitura-hora').textContent = formatarHora(lerData(l.dataHora));
		preencherTipo(linha, l.tipoResiduo, l.prioridade);
		linha.querySelector('.leitura-sensor').textContent = l.numeroSensor;
		linha.querySelector('.leitura-distancia').textContent = formatarNumero(Number(l.distanciaCm), 1);
		linha.querySelector('.leitura-nivel').className = 'leitura-nivel nivel-' + SITUACOES[l.situacao];
		linha.querySelector('.leitura-nivel-valor').textContent = Math.round(Number(l.nivelPct));
		corpo.appendChild(linha);
	}
	// volta a lista para o topo (a leitura mais nova) ao trocar de data
	document.getElementById('leituras-rolagem').scrollTop = 0;

	let vazio = linhas.length == 0;
	document.getElementById('leituras-rolagem').hidden = vazio;
	document.getElementById('leituras-vazia').hidden = !vazio;
	mostrar(document.getElementById('leituras-com'), !vazio);
	mostrar(document.getElementById('leituras-sem'), vazio);
	escrever('leituras-qtd', linhas.length);
	aplicarPlural(document.getElementById('leituras-palavra'), linhas.length);
}


// ==================================================================
// INICIALIZAÇÃO
// ==================================================================
function atualizarTudo() {
	agora = new Date();
	prepararDados(carregarDados());
	renderizarTopo();
	renderizarAlerta();
	renderizarIndicadores();
	renderizarConsulta();
	renderizarBairros();
	atualizarGraficoBairros();
}

function trocarCenario() {
	exemploAtual = null;
	filtro.bairro = '';
	document.getElementById('select-ponto').value = '';
	voltarVisaoGeral();
	atualizarTudo();
}


// começa aqui (no fim do script, depois de todas as variáveis declaradas)
atualizarTudo();
// Com o banco: atualizar a cada 1 min (o sensor manda leitura a cada 15 min)
// setInterval(atualizarTudo, 60000);