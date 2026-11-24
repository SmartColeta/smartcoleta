var express = require("express");
var router = express.Router();

var dashboardController = require("../controllers/dashboardController");

router.get("/estado/:idPrefeitura", function (req, res) {
    dashboardController.estado(req, res);
});

router.get("/ponto/:idPonto", function (req, res) {
    dashboardController.ultimaColeta(req, res);
});

router.get("/historico/:idPonto/:periodo", function (req, res) {
    dashboardController.historico(req, res);
});

router.get("/leituras/:idPonto/:data", function (req, res) {
    dashboardController.leiturasDoDia(req, res);
});

module.exports = router;