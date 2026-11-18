var usuarioModel = require("../models/usuarioModel");

function autenticar(req, res) {
  var email = req.body.emailServer;
  var senha = req.body.senhaServer;

  if (email == undefined) {
    res.status(400).send("Seu email está undefined!");
  } else if (senha == undefined) {
    res.status(400).send("Sua senha está indefinida!");
  } else {
    // NOVO: primeiro confere se o e-mail está cadastrado
    usuarioModel
      .buscarPorEmail(email)
      .then(function (resultadoEmail) {
        if (resultadoEmail.length == 0) {
          res.status(404).send("E-mail não cadastrado");
          return;
        }
        usuarioModel
          .autenticar(email, senha)
          .then(function (resultadoAutenticar) {
            console.log(`\nResultados encontrados: ${resultadoAutenticar.length}`);
            console.log(`Resultados: ${JSON.stringify(resultadoAutenticar)}`); // transforma JSON em String

            if (resultadoAutenticar.length == 1) {
              console.log(resultadoAutenticar);

              // a senha não volta para o navegador; vai a prefeitura do usuário
              res.json({
                id: resultadoAutenticar[0].id,
                email: resultadoAutenticar[0].email,
                nome: resultadoAutenticar[0].nome,
                fkPrefeitura: resultadoAutenticar[0].fkPrefeitura,
              });
            } else if (resultadoAutenticar.length == 0) {
              res.status(403).send("Email e/ou senha inválido(s)");
            } else {
              res.status(403).send("Mais de um usuário com o mesmo login e senha!");
            }
          })
          .catch(function (erro) {
            console.log(erro);
            console.log(
              "\nHouve um erro ao realizar o login! Erro: ",
              erro.sqlMessage,
            );
            res.status(500).json(erro.sqlMessage);
          });
      })
      .catch(function (erro) {
        console.log(erro);
        res.status(500).json(erro.sqlMessage);
      });
  }
}

//Função que confere se a senha é forte
function senhaForte(senha) {
  var temMaiuscula = false;
  var temMinuscula = false;
  var temNumero = false;
  var temEspecial = false;
  var especiais = "!@#$%&*()-_=+[]{};:,.<>?/|~";

  for (var i = 0; i < senha.length; i++) {
    var letra = senha[i];

    if (letra >= 'A' && letra <= 'Z') {
      temMaiuscula = true;
    } else if (letra >= 'a' && letra <= 'z') {
      temMinuscula = true;
    } else if (letra >= '0' && letra <= '9') {
      temNumero = true;
    } else if (especiais.includes(letra)) {
      temEspecial = true;
    }
  }

  return senha.length >= 8 && temMaiuscula && temMinuscula && temNumero && temEspecial;
}

function cadastrar(req, res) {
  var nome = req.body.nomeServer;
  var email = req.body.emailServer;
  var senha = req.body.senhaServer;
  var codigoAcesso = req.body.codigoAcessoServer;

  if (nome == undefined) {
    res.status(400).send("Seu nome está undefined!");
  } else if (email == undefined) {
    res.status(400).send("Seu email está undefined!");
  } else if (senha == undefined) {
    res.status(400).send("Sua senha está undefined!");
  } else if (codigoAcesso == undefined || codigoAcesso == "") {
    res.status(400).send("Informe o código de acesso da sua prefeitura.");
  } else if (!senhaForte(senha)) {
    res.status(400).send("A senha deve ter no mínimo 8 caracteres, com letras maiúsculas e minúsculas, números e caracteres especiais.");
  } else {
    var idUsuario;
    var falhou = false; // true quando uma validação já respondeu ao cliente

    //o e-mail precisa estar pré-autorizado (existir na tabela usuario)
    usuarioModel
      .buscarUsuarioPreAutorizado(email)
      .then(function (usuarios) {
        if (usuarios.length == 0) {
          falhou = true;
          res.status(403).send("E-mail não autorizado. Peça à sua prefeitura para cadastrar seu e-mail.");
          return;
        }
        if (usuarios[0].senha != null) {
          falhou = true;
          res.status(409).send("Este e-mail já foi cadastrado. Faça login.");
          return;
        }
        idUsuario = usuarios[0].idUsuario;

        // o código de acesso precisa existir e ser da mesma prefeitura do e-mail (fkPrefeitura)
        return usuarioModel
          .buscarPrefeituraPorCodigo(codigoAcesso)
          .then(function (prefeituras) {
            if (prefeituras.length == 0 || prefeituras[0].idPrefeitura != usuarios[0].fkPrefeitura) {
              falhou = true;
              res.status(400).send("Código de acesso inválido. Confira o código enviado pela sua prefeitura.");
              return;
            }

            // validado: completa o cadastro com nome e senha
            return usuarioModel.cadastrar(idUsuario, nome, senha);
          });
      })
      .then(function (resultado) {
        if (falhou) {
          return;
        }
        // affectedRows = 0: o cadastro foi concluído por outra requisição no meio do caminho
        if (resultado.affectedRows == 0) {
          res.status(409).send("Este e-mail já foi cadastrado. Faça login.");
        } else {
          res.json(resultado);
        }
      })
      .catch(function (erro) {
        console.log(erro);
        console.log(
          "\nHouve um erro ao realizar o cadastro! Erro: ",
          erro.sqlMessage,
        );
        res.status(500).json(erro.sqlMessage);
      });
  }
}

module.exports = {
  autenticar,
  cadastrar,
};