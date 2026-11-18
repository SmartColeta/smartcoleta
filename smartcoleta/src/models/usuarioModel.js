var database = require("../database/config")

// Os valores entram no lugar de cada "?" (na mesma ordem da lista),
// do mesmo jeito que o INSERT da API dat-acqu-ino. Isso evita SQL injection.

function buscarPorEmail(email) {
    var instrucaoSql = `
        SELECT idUsuario FROM usuario WHERE email = ?;
    `;
    console.log("Executando a instrução SQL: \n" + instrucaoSql);
    return database.executar(instrucaoSql, [email]);
}

function autenticar(email, senha) {
    console.log("ACESSEI O USUARIO MODEL \n \n\t\t >> Se aqui der erro de 'Error: connect ECONNREFUSED',\n \t\t >> verifique suas credenciais de acesso ao banco\n \t\t >> e se o servidor de seu BD está rodando corretamente. \n\n function entrar(): ", email);
    var instrucaoSql = `
        SELECT idUsuario AS id, nome, email, fkPrefeitura FROM usuario WHERE email = ? AND senha = ?;
    `;
    console.log("Executando a instrução SQL: \n" + instrucaoSql);
    return database.executar(instrucaoSql, [email, senha]);
}

// Traz a prefeitura do email se ele já está cadastrado
function buscarUsuarioPreAutorizado(email){
    var instrucaoSql = `
        SELECT idUsuario, fkPrefeitura, senha
        FROM usuario WHERE email = ?;
    `;
    console.log("Executando a instrução SQL: \n" + instrucaoSql);
    return database.executar(instrucaoSql, [email]);
}

// Traz o id da prefeitura dona do código de acesso (se ele existir)
function buscarPrefeituraPorCodigo(codigoAcesso){
    var instrucaoSql = `
        SELECT idPrefeitura
        FROM prefeitura WHERE codigoAcesso = ?;
    `;
    console.log("Executando a instrução SQL: \n" + instrucaoSql);
    return database.executar(instrucaoSql, [codigoAcesso]);
}

// Completa o cadastro com nome e senha. "senha IS NULL" garante que um usuário
// já cadastrado não tenha a senha sobrescrita por quem só conhece o e-mail e o código.

function cadastrar(idUsuario, nome, senha){
    var instrucaoSql = `
        UPDATE usuario
        SET nome = ?, senha = ?
        WHERE idUsuario = ? AND senha IS NULL;
    `;
    console.log("Executando a instrução SQL: \n" + instrucaoSql);
    return database.executar(instrucaoSql, [nome, senha, idUsuario]);
}

module.exports = {
    buscarPorEmail,
    autenticar,
    buscarUsuarioPreAutorizado,
    buscarPrefeituraPorCodigo,
    cadastrar
};
