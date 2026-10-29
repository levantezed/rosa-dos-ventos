const $ = (s) => document.querySelector(s);
const grade = $('#grade'), status = $('#status');
let posts = [], token = sessionStorage.getItem('token'), editandoId = null, excluirId = null, buscaTimer;

const fmtData = (iso) => new Date(iso).toLocaleDateString('pt-BR');
const el = (tag, cls, txt) => { const e = document.createElement(tag); if (cls) e.className = cls; if (txt != null) e.textContent = txt; return e; };

async function api(url, opts = {}) {
  opts.headers = { ...(opts.headers || {}), ...(token ? { Authorization: 'Bearer ' + token } : {}) };
  const r = await fetch(url, opts);
  const dados = await r.json().catch(() => ({}));
  if (r.status === 401 && token) sair();
  if (!r.ok) throw new Error(dados.error || 'Algo deu errado.');
  return dados;
}

async function carregar() {
  const q = $('#busca').value.trim();
  status.textContent = 'Carregando…';
  try {
    posts = await api('/api/posts' + (q ? '?q=' + encodeURIComponent(q) : ''));
    desenhar(q);
  } catch (e) { grade.replaceChildren(); status.textContent = e.message; }
}

function chips(lista) {
  const c = el('div', 'chips');
  lista.forEach((k) => c.append(el('span', 'chip', k)));
  return c;
}

function desenhar(q) {
  grade.replaceChildren();
  status.textContent = posts.length ? '' : q ? 'Nenhuma publicação encontrada para essa busca.' : 'Ainda não há publicações.' + (token ? ' Clique em “Adicionar conteúdo”.' : '');
  posts.forEach((p) => {
    const card = el('button', 'card');
    card.type = 'button';
    if (p.image_url) { const i = el('img'); i.src = p.image_url; i.alt = ''; i.loading = 'lazy'; card.append(i); }
    const corpo = el('div', 'card-corpo');
    corpo.append(el('h3', null, p.title), el('span', 'data', fmtData(p.created_at)));
    const previa = p.content.replace(/\s+/g, ' ');
    corpo.append(el('p', 'previa', previa.length > 150 ? previa.slice(0, 150).trim() + '…' : previa));
    if (p.keywords.length) corpo.append(chips(p.keywords));
    card.append(corpo);
    card.addEventListener('click', () => abrir(p));
    grade.append(card);
  });
}

function abrir(p) {
  const box = $('#post-aberto');
  box.replaceChildren();
  if (p.image_url) { const i = el('img'); i.src = p.image_url; i.alt = p.title; box.append(i); }
  const c = el('div', 'leitura');
  c.append(el('h2', null, p.title), el('span', 'data', 'Publicado em ' + fmtData(p.created_at)));
  const t = el('div', 'texto');
  p.content.split(/\n\s*\n/).forEach((par) => { const e = el('p', null, par.trim()); e.style.whiteSpace = 'pre-line'; t.append(e); });
  c.append(t);
  if (p.keywords.length) c.append(chips(p.keywords));
  const barra = el('div', 'linha-btn');
  const admin = el('div', 'admin');
  if (token) {
    const ed = el('button', 'btn btn-sec', 'Editar'); ed.onclick = () => { $('#dlg-post').close(); abrirForm(p); };
    const ex = el('button', 'btn btn-sec', 'Excluir'); ex.onclick = () => { excluirId = p.id; $('#dlg-post').close(); $('#dlg-excluir').showModal(); };
    admin.append(ed, ex);
  }
  const fechar = el('button', 'btn btn-pri', 'Fechar'); fechar.onclick = () => $('#dlg-post').close();
  barra.append(admin, fechar);
  c.append(barra);
  box.append(c);
  $('#dlg-post').showModal();
}

function abrirForm(p) {
  const f = $('#form');
  f.reset();
  editandoId = p ? p.id : null;
  $('#form-titulo').textContent = p ? 'Editar conteúdo' : 'Adicionar conteúdo';
  $('#form-ok').textContent = p ? 'Salvar alterações' : 'Publicar';
  $('#form-erro').textContent = '';
  $('#img-atual').hidden = !(p && p.image_url);
  if (p) {
    f.title.value = p.title; f.content.value = p.content; f.keywords.value = p.keywords.join(', ');
    if (p.image_url) $('#img-atual-prev').src = p.image_url;
  }
  $('#dlg-form').showModal();
}

$('#form').addEventListener('submit', async (e) => {
  e.preventDefault();
  const btn = $('#form-ok'); btn.disabled = true; $('#form-erro').textContent = '';
  const fd = new FormData(e.target);
  if (!fd.get('image') || !fd.get('image').size) fd.delete('image');
  if ($('#remover-img').checked) fd.append('remove_image', 'true');
  try {
    await api(editandoId ? '/api/posts/' + editandoId : '/api/posts', { method: editandoId ? 'PUT' : 'POST', body: fd });
    $('#dlg-form').close();
    await carregar();
  } catch (err) { $('#form-erro').textContent = err.message; }
  btn.disabled = false;
});

$('#confirma-excluir').addEventListener('click', async () => {
  try { await api('/api/posts/' + excluirId, { method: 'DELETE' }); $('#dlg-excluir').close(); await carregar(); }
  catch (err) { alert(err.message); }
});

function atualizarBotoes() {
  $('#btn-entrar').hidden = !!token; $('#btn-sair').hidden = !token; $('#btn-novo').hidden = !token;
}
function sair() { token = null; sessionStorage.removeItem('token'); atualizarBotoes(); }
$('#btn-entrar').onclick = () => { $('#form-login').reset(); $('#login-erro').textContent = ''; $('#dlg-login').showModal(); };
$('#btn-sair').onclick = () => { sair(); carregar(); };
$('#btn-novo').onclick = () => abrirForm(null);
$('#form-login').addEventListener('submit', async (e) => {
  e.preventDefault();
  try {
    const r = await api('/api/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ password: e.target.password.value }) });
    token = r.token; sessionStorage.setItem('token', token);
    $('#dlg-login').close(); atualizarBotoes(); carregar();
  } catch (err) { $('#login-erro').textContent = err.message; }
});

document.querySelectorAll('[data-fechar]').forEach((b) => b.addEventListener('click', () => b.closest('dialog').close()));
$('#busca').addEventListener('input', () => { clearTimeout(buscaTimer); buscaTimer = setTimeout(carregar, 250); });
$('#ano').textContent = new Date().getFullYear();
atualizarBotoes();
if (token) api('/api/me').catch(() => {});
carregar();
