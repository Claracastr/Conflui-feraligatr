# Contratos e decisões do Conflui

A documentação executável de todos os contratos fica em `http://127.0.0.1:8000/docs` e `/openapi.json`. A coleção Postman acompanha os principais percursos, exemplos e verificações. Não há contrato de câmera da equipe disponível nesta entrega: este é o contrato inicial e o processador existente poderá enviar para ele ou receber um adaptador quando seu contrato for fornecido.

## Aquisição

`POST /observations` exige `X-Ingest-Key`, configurada somente no processo de aquisição e no backend. A sessão do gestor não substitui essa chave. Captura com fuso obrigatório e recebimento em UTC são campos diferentes. Horários futuros acima de dois minutos são rejeitados. A API não aceita posições em pixels de vídeo.

```json
{
  "observation_id": "camera-cinema-2026-11-14T18:00:00Z",
  "camera_id": "sim-cinema",
  "sector_id": "cinema",
  "captured_at": "2026-11-14T18:00:00Z",
  "count": 12,
  "positions": [{"x": 700, "y": 500}],
  "coordinate_system": "map_1000x734",
  "source": "simulator",
  "status": "available"
}
```

As posições são uma amostra espacial, não identidades ou trajetórias. `count=0` significa medição de região vazia. Indisponibilidade exige `status=unavailable`, `count=null`, `positions=[]`. Sem calibração, vídeo pode enviar apenas contagem e `coordinate_system=none`. Coordenadas da planta têm x de 0 a 1000 e y de 0 a 734.

A chave de idempotência é `observation_id`, global: repetir o mesmo conteúdo devolve `duplicate=true`; reutilizar o ID com conteúdo diferente devolve 409. O simulador repete a mesma carga nos retries. Os registros são separados por `DATA_MODE`: `simulator` aceita somente simulador e amostras sintéticas; `video` aceita somente vídeo e pesquisas independentes. Para piloto real, use outro banco e outra chave. Não mude um banco de demonstração para produção conservando suas câmeras conceituais.

## Cobertura

Cada setor possui uma única câmera autoritativa no MVP. Essa restrição é imposta no banco e na API; uma segunda câmera do mesmo setor resulta em 409. Regiões sobrepostas devem ser redefinidas/calibradas antes do piloto. Não existe fusão multivisão nem rastreamento entre câmeras. As 18 regiões do catálogo são propostas conceituais na planta real recuperada do protótipo, sem certificação de cobertura física.

`PUT /cameras/{id}` configura a câmera responsável, descrição de cobertura e homografia 3×3. `calibrated=true` exige matriz não singular. A veracidade e a qualidade da calibração exigem medição em campo; um formulário não comprova calibração. Use quatro ou mais pontos correspondentes, distribua-os no chão do setor, estime a transformação e confira o erro em pontos separados antes de ativar o calor de vídeo.

## Consultas de ocupação

`GET /occupancy/live` entrega todas as regiões de um mesmo instante de consulta. Por região seleciona a última captura até esse instante, com tolerância máxima de 15 minutos. Não soma câmeras. `STALE_SECONDS`, padrão 30 s, separa disponível de atrasado no modo ao vivo. Capturas além de 15 minutos retornam indisponibilidade; ausências não viram zero. `total` soma somente setores com dados, com `available_sectors/total_sectors` para explicitar cobertura parcial.

`GET /occupancy/history?date=AAAA-MM-DD&minute=1080` usa o fuso `America/Araguaina`. Janela padrão 540–1440 minutos: 09h até meia-noite. `minute=1440` pertence ao fechamento operacional da data escolhida, isto é, 00h do dia civil seguinte. A consulta das 09h seguintes não herda a medição da noite anterior. O calendário atribui a captura das 00h à data operacional anterior.

O replay usa `/occupancy/timeline`, com passo mínimo de 15 minutos e máximo de 60. Há também comparação, filtros por setor e pavimento, CSV e metadados. Não há médias por dia da semana implementadas: a interface representa datas específicas. Cores mantêm a mesma escala entre mapas. O frontend usa cache de instantâneos históricos e polling ao vivo de 5 s; posições são interpoladas apenas para apresentação, sem criar medições.

## Histórico e retenção

Não há gravação de vídeo. O processador envia no máximo uma medição a cada intervalo configurado, padrão 5 s. O histórico sintético é persistido em recortes de 15 minutos. O comando `python -m conflui.cli purge` remove as posições após 7 dias e contagens/passagens após 90 dias, ajustáveis no `.env`. Contagens são preservadas até o limite histórico; depois da remoção das posições o calor fica indisponível, sem fabricar distribuição. Agende esse comando diariamente no computador ou servidor do piloto. Ele não roda automaticamente nesta entrega.

O MVP não agrega automaticamente as medições de vídeo em tabelas horárias: conserva as observações recebidas dentro da retenção. Para escala maior, implementar compactação após avaliar precisão e volume. Não são salvos quadros, faces ou embeddings.

## Eventos, perfil e métricas

Eventos são persistidos com setores e janela diária; o período inclui as datas inicial e final. A análise amostra a ocupação a cada 15 min e informa média **por setor observado**, pico por setor, número de amostras válidas, limites e passagens no intervalo. Ausências não entram na média. Não é público acumulado do evento. A referência de comparação é uma consulta separada, não prova de ausência de eventos ou de causalidade.

Fluxos são registros independentes de passagens, enviados a `/passages`. Só entram registros inteiramente contidos no intervalo consultado. Percentual usa como denominador as passagens registradas da mesma origem nesse intervalo. A PoC de vídeo não gera passagens entre setores: essa integração depende de linhas de contagem, cobertura e validação próprias. Nada é inferido apenas da ocupação.

Perfil é pesquisa agregada independente, sintética no modo de demonstração. A API valida `n`, categorias, desconhecidos e a soma de cada dimensão. Gênero e idade não são somados. Amostras diárias e de evento são coortes separadas; a consulta diária exclui as de evento para não somar populações possivelmente sobrepostas. O produtor da pesquisa deve garantir que amostras de setores sejam disjuntas; o sistema não recebe identidades para deduplicá-las. `GET /profiles/available` lista as datas com amostra para orientar o recorte, sem preencher lacunas. Não há classificação facial, extrapolação ou nota de diversidade.

A faixa etária usada é 0–11, 12–17, 18–59 e 60+ anos. Fontes reais exigem proveniência e permissão apropriadas. No piloto sem pesquisa, a resposta é indisponibilidade, mesmo com ocupação medida por vídeo. Feriados são cadastros com fonte e validação, sem integração externa automática.

## Banco local

O MVP utiliza SQLite no arquivo `conflui.db`, relativo à raiz do projeto, independentemente da pasta de onde o comando é executado. O Python já inclui o driver. Não há serviço de banco separado nem credenciais de banco. Chaves estrangeiras ficam ativas, WAL permite leituras durante as gravações e o tempo de espera por bloqueio é de 30 segundos. As migrations continuam versionadas com Alembic e são aplicadas por `configurar.py`. Os timestamps são normalizados para UTC e a API devolve o fuso explicitamente. Esta configuração atende o MVP local; não pretende atender dezenas de processadores gravando simultaneamente.

## Autenticação e execução

Senhas Argon2id; token de sessão aleatório de 256 bits; somente seu SHA-256 é persistido. Cookie HttpOnly, SameSite=Lax, validade padrão 8h. Logout revoga o registro. Cadastro administrativo só por CLI interativa. CORS explícito e verificação de Origin em mutações de sessão. Não existe bypass demonstrativo: inclusive no banco sintético é necessário um administrador. HTTPS e `COOKIE_SECURE=true` são obrigatórios para publicação real. O frontend e a API devem ficar no mesmo site ou atrás de proxy; o fluxo local Vite usa `/api/`.

O piloto está preparado para execução local. O site estático anteriormente publicado continua sendo a referência visual e não hospeda o backend Python. Esta entrega não publica um servidor, não altera o acesso daquele site e não envia os arquivos automaticamente ao GitHub.

## Referências técnicas

- FastAPI: https://fastapi.tiangolo.com/advanced/response-cookies/
- Ultralytics, rastreamento persistente e ByteTrack: https://docs.ultralytics.com/modes/track/
- SQLAlchemy: https://docs.sqlalchemy.org/en/20/
- Alembic: https://alembic.sqlalchemy.org/en/latest/

O detector opcional usa pesos YOLO11n e ByteTrack, sem treinamento. A adequação no equipamento e a precisão com o vídeo do shopping ainda precisam de validação. A instalação é separada para não exigir PyTorch e OpenCV de quem só precisa executar a API.
