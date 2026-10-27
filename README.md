# Assistente Financeiro

App (PWA) que mostra quanto posso gastar no mês, faturas futuras, parcelas e investimentos.
Os dados vêm de uma planilha Google Sheets alimentada pelo Open Finance (Pluggy).

- `index.html`, `app.js`, `styles.css`, `sw.js`: o app, publicado pelo GitHub Pages.
- `apps-script/Sincronizacao.gs`: script da planilha (sincronização com a Pluggy e API do app).
- `docs/`: passo a passo de instalação.

Nenhum dado financeiro fica neste repositório. O app lê a planilha com um código de acesso guardado só no aparelho.
