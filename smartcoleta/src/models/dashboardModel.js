var database = require("../database/config");

function estado(idPrefeitura){
    var instrucaoSql = `
                    SELECT * FROM vw_estado_compartimento
                    WHERE idPrefeitura = ?
                    ORDER BY pesoSituacao DESC, prioridade, horasProximoLimite IS NULL, horasProximoLimite, nivelPct DESC;
                    `;
    return database.executar(instrucaoSql, [idPrefeitura]);
}

function resumo(idPrefeitura){
    var instrucaoSql = `
                        SELECT * FROM vw_resumo_prefeitura
                        WHERE idPrefeitura = ?;
                        `;
    return database.executar(instrucaoSql, [idPrefeitura]);
}

function bairros(idPrefeitura){
    var instrucaoSql = `
                        SELECT * FROM vw_resumo_bairro
                        WHERE idPrefeitura = ?
                        ORDER BY pontosCriticos DESC, pontosAtencao DESC, bairro;`
    return database.executar(instrucaoSql, [idPrefeitura]);
}

function ultimaColeta(idPonto){
    var instrucaoSql = `
        SELECT * FROM vw_ultima_coleta_ponto
        WHERE idPonto = ?
        ORDER BY prioridade;
        `
    return database.executar(instrucaoSql, [idPonto]);
}

var CONSULTAS_HISTORICO = {
    "24h": `
        SELECT c.idCompartimento, t.nome AS tipoResiduo, t.prioridade, s.numeroSensor,
               pa.limiteAtencao, pa.limiteCritico,
               l.dataHora AS inicioIntervalo, l.distanciaCm,
               CASE WHEN l.distanciaCm >= c.alturaCm THEN 0
                    WHEN l.distanciaCm <= 0 THEN 100
                    ELSE ROUND((1 - l.distanciaCm / c.alturaCm) * 100, 2) END AS nivelPct
        FROM compartimento c
        JOIN tipo_residuo t    ON t.idTipoResiduo = c.fkTipoResiduo
        JOIN parametrizacao pa ON pa.idParametrizacao = c.fkParametrizacao
        JOIN sensor s          ON s.fkCompartimento = c.idCompartimento
        JOIN leitura l         ON l.fkSensor = s.idSensor
        WHERE c.fkPontoColeta = ?
          AND l.dataHora >= NOW() - INTERVAL 24 HOUR
        ORDER BY c.idCompartimento, l.dataHora;
    `,
    "7d": `
        SELECT c.idCompartimento, t.nome AS tipoResiduo, t.prioridade, s.numeroSensor,
               pa.limiteAtencao, pa.limiteCritico,
               DATE_FORMAT(l.dataHora, '%Y-%m-%d %H:00:00') AS inicioIntervalo,
               MAX(CASE WHEN l.distanciaCm >= c.alturaCm THEN 0
                        WHEN l.distanciaCm <= 0 THEN 100
                        ELSE ROUND((1 - l.distanciaCm / c.alturaCm) * 100, 2) END) AS nivelPct
        FROM compartimento c
        JOIN tipo_residuo t    ON t.idTipoResiduo = c.fkTipoResiduo
        JOIN parametrizacao pa ON pa.idParametrizacao = c.fkParametrizacao
        JOIN sensor s          ON s.fkCompartimento = c.idCompartimento
        JOIN leitura l         ON l.fkSensor = s.idSensor
        WHERE c.fkPontoColeta = ?
          AND l.dataHora >= NOW() - INTERVAL 7 DAY
        GROUP BY c.idCompartimento, t.nome, t.prioridade, s.numeroSensor,
                 pa.limiteAtencao, pa.limiteCritico, inicioIntervalo
        ORDER BY c.idCompartimento, inicioIntervalo;
    `,
    "30d": `
        SELECT c.idCompartimento, t.nome AS tipoResiduo, t.prioridade, s.numeroSensor,
               pa.limiteAtencao, pa.limiteCritico,
               DATE_FORMAT(DATE(l.dataHora) + INTERVAL (CASE WHEN HOUR(l.dataHora) < 6 THEN 0
                                                             WHEN HOUR(l.dataHora) < 12 THEN 6
                                                             WHEN HOUR(l.dataHora) < 18 THEN 12
                                                             ELSE 18 END) HOUR,
                           '%Y-%m-%d %H:00:00') AS inicioIntervalo,
               MAX(CASE WHEN l.distanciaCm >= c.alturaCm THEN 0
                        WHEN l.distanciaCm <= 0 THEN 100
                        ELSE ROUND((1 - l.distanciaCm / c.alturaCm) * 100, 2) END) AS nivelPct
        FROM compartimento c
        JOIN tipo_residuo t    ON t.idTipoResiduo = c.fkTipoResiduo
        JOIN parametrizacao pa ON pa.idParametrizacao = c.fkParametrizacao
        JOIN sensor s          ON s.fkCompartimento = c.idCompartimento
        JOIN leitura l         ON l.fkSensor = s.idSensor
        WHERE c.fkPontoColeta = ?
          AND l.dataHora >= NOW() - INTERVAL 30 DAY
        GROUP BY c.idCompartimento, t.nome, t.prioridade, s.numeroSensor,
                 pa.limiteAtencao, pa.limiteCritico, inicioIntervalo
        ORDER BY c.idCompartimento, inicioIntervalo;
    `,
    "90d": `
        SELECT c.idCompartimento, t.nome AS tipoResiduo, t.prioridade, s.numeroSensor,
               pa.limiteAtencao, pa.limiteCritico,
               DATE_FORMAT(l.dataHora, '%Y-%m-%d 00:00:00') AS inicioIntervalo,
               MAX(CASE WHEN l.distanciaCm >= c.alturaCm THEN 0
                        WHEN l.distanciaCm <= 0 THEN 100
                        ELSE ROUND((1 - l.distanciaCm / c.alturaCm) * 100, 2) END) AS nivelPct
        FROM compartimento c
        JOIN tipo_residuo t    ON t.idTipoResiduo = c.fkTipoResiduo
        JOIN parametrizacao pa ON pa.idParametrizacao = c.fkParametrizacao
        JOIN sensor s          ON s.fkCompartimento = c.idCompartimento
        JOIN leitura l         ON l.fkSensor = s.idSensor
        WHERE c.fkPontoColeta = ?
          AND l.dataHora >= CURDATE() - INTERVAL 89 DAY
        GROUP BY c.idCompartimento, t.nome, t.prioridade, s.numeroSensor,
                 pa.limiteAtencao, pa.limiteCritico, inicioIntervalo
        ORDER BY c.idCompartimento, inicioIntervalo;
    `
};

function historico(idPonto, periodo){
    return database.executar(CONSULTAS_HISTORICO[periodo], [idPonto]);
}

function leiturasDoDia(idPonto, data){
    var instrucaoSql = `SELECT l.dataHora, c.idCompartimento, t.nome AS tipoResiduo, t.prioridade,
               s.numeroSensor, l.distanciaCm,
               CASE WHEN l.distanciaCm >= c.alturaCm THEN 0
                    WHEN l.distanciaCm <= 0 THEN 100
                    ELSE ROUND((1 - l.distanciaCm / c.alturaCm) * 100, 2) END AS nivelPct,
               CASE WHEN (1 - l.distanciaCm / c.alturaCm) * 100 >= pa.limiteCritico THEN 'Critico'
                    WHEN (1 - l.distanciaCm / c.alturaCm) * 100 >= pa.limiteAtencao THEN 'Atencao'
                    ELSE 'Normal' END AS situacao
        FROM compartimento c
        JOIN tipo_residuo t    ON t.idTipoResiduo = c.fkTipoResiduo
        JOIN parametrizacao pa ON pa.idParametrizacao = c.fkParametrizacao
        JOIN sensor s          ON s.fkCompartimento = c.idCompartimento
        JOIN leitura l         ON l.fkSensor = s.idSensor
        WHERE c.fkPontoColeta = ?
          AND l.dataHora >= ?
          AND l.dataHora < ? + INTERVAL 1 DAY
        ORDER BY l.dataHora DESC, c.idCompartimento;
    `;
    return database.executar(instrucaoSql, [idPonto, data, data]);
}

module.exports = {
    estado,
    resumo,
    bairros,
    ultimaColeta,
    historico,
    leiturasDoDia
}