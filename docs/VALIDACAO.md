# Validação do MVP com SQLite

## Implementado

- SQLite em arquivo local, com chaves estrangeiras, WAL, espera por bloqueios e caminho consistente a partir da raiz.
- Remoção do arquivo Compose e do driver de banco externo das dependências.
- `configurar.py`: ambiente, chave de aquisição, migrations, catálogo, histórico e criação interativa do administrador.
- `iniciar.py`: API e simulador em processos separados, controlados pelo mesmo terminal e encerrados juntos.
- Interface original, plantas, mapa de calor fluido, login, histórico, calendário, eventos, perfil agregado, fluxos e exportação mantidos.
- README com seis seções e guia refeito para iniciar em dois terminais.

## Verificações

**Resultado: 19 testes Python, 6 testes JavaScript e build Vite/Tailwind passaram.** A configuração inicial completa também foi executada em uma cópia temporária do projeto: migrations, catálogo, histórico, criação de administrador, login pela API e reabertura sem apagar os favoritos.

A suíte de API roda em arquivos SQLite temporários, com a mesma configuração de banco usada pela aplicação. Ela cobre autenticação, idempotência, histórico e meia-noite, ausência de dados, separação de origens, eventos, favoritos, marcações, perfil e histórico sintético estável.

Há testes adicionais da configuração automática, aplicação/reversão das migrations e persistência depois de fechar e reabrir um arquivo SQLite. A suíte JavaScript cobre calendários, disponibilidade, instantâneos globais e contratos do cliente. O build Vite/Tailwind também é verificado.

## Limites

O percurso completo de dois terminais no Windows não foi executado neste ambiente Linux. O controle dos processos do launcher foi testado com substitutos locais, sem iniciar uma câmera. A API foi exercitada por TestClient com SQLite real em arquivo, sem depender de um servidor HTTP externo.

Não foram fornecidos vídeo do shopping, contrato da API de câmera da equipe, credenciais ou calibração. O detector opcional não foi executado e a integração física continua pendente. Dados simulados não comprovam precisão de câmeras, perfil demográfico ou contagem de visitantes únicos.

O SQLite é a escolha para este MVP local. Esta entrega não afirma suporte a muitos processadores gravando simultaneamente e não publica o backend no site estático anterior.
