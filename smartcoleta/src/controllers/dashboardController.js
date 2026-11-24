var dashboardModel = require("../models/dashboardModel");

var PERIODOS = ["24h", "7d", "30d", "90d"];

function estado(req, res) {
  var idPrefeitura = req.params.idPrefeitura;

  Promise.all([
    dashboardModel.estado(idPrefeitura),
    dashboardModel.resumo(idPrefeitura),
    dashboardModel.bairros(idPrefeitura),
  ])

    .then(function (resultados) {
      res.json({
        linhasEstado: resultados[0],
        resumo: resultados[1][0],
        bairros: resultados[2],
      });
    })
    .catch(function (erro) {
      console.log(
        "\nHouve um erro ao buscar o estado da dashboard! Erro: ",
        erro.sqlMessage,
      );
      res.status(500).json(erro.sqlMessage);
    });
}

function ultimaColeta(req, res) {
  dashboardModel
    .ultimaColeta(req.params.idPonto)
    .then(function (resultado) {
      res.json(resultado);
    })
    .catch(function (erro) {
      console.log(
        "\nHouve um erro ao buscar a última coleta! Erro: ",
        erro.sqlMessage,
      );
      res.status(500).json(erro.sqlMessage);
    });
}

function historico(req, res) {
  var periodo = req.params.periodo;

  if (PERIODOS.indexOf(periodo) == -1) {
    res.status(400).send("Período inválido!");
    return;
  }

  dashboardModel
    .historico(req.params.idPonto, periodo)
    .then(function (resultado) {
      res.json(resultado);
    })
    .catch(function (erro) {
      console.log(
        "\nHouve um erro ao buscar o histórico! Erro: ",
        erro.sqlMessage,
      );
      res.status(500).json(erro.sqlMessage);
    });
}

function leiturasDoDia(req, res) {
    var data = req.params.data;

    // a data precisa estar no formato AAAA-MM-DD
    if (!/^\d{4}-\d{2}-\d{2}$/.test(data)) {
        res.status(400).send("Data inválida!");
        return;
    }

    dashboardModel
        .leiturasDoDia(req.params.idPonto, data)
        .then(function (resultado) {
            res.json(resultado);
        })
        .catch(function (erro) {
            console.log("\nHouve um erro ao buscar as leituras do dia! Erro: ", erro.sqlMessage);
            res.status(500).json(erro.sqlMessage);
        });
}

module.exports = {
    estado,
    ultimaColeta,
    historico,
    leiturasDoDia
};