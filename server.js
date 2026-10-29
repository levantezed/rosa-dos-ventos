// 
// 
require('dotenv').config();
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const multer = require('multer');
const { createClient } = require('@supabase/supabase-js');

const { SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, ADMIN_PASSWORD, SESSION_SECRET } = process.env;
const BUCKET = process.env.SUPABASE_BUCKET || 'post-images';
const PORT = process.env.PORT || 3000;

const faltando = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY', 'ADMIN_PASSWORD', 'SESSION_SECRET']
  .filter((k) => !process.env[k]);
if (faltando.length) {
  console.error('Faltam variáveis no arquivo .env: ' + faltando.join(', '));
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => cb(null, /^image\/(jpeg|png|webp|gif)$/.test(file.mimetype)),
});

const app = express();
app.use(express.json());
app.use(express.static(path.join(__dirname, 'public')));

/* ---------- Autenticação simples (token assinado, válido por 12h) ---------- */
const sign = (data) => crypto.createHmac('sha256', SESSION_SECRET).update(data).digest('hex');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)), y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};
function criarToken() {
  const exp = Date.now() + 12 * 60 * 60 * 1000;
  return `${exp}.${sign(String(exp))}`;
}
function exigirAdmin(req, res, next) {
  const token = (req.headers.authorization || '').replace('Bearer ', '');
  const [exp, assinatura] = token.split('.');
  if (exp && assinatura && Number(exp) > Date.now() && safeEqual(assinatura, sign(exp))) return next();
  res.status(401).json({ error: 'Sessão inválida ou expirada. Entre novamente.' });
}

app.post('/api/login', (req, res) => {
  if (safeEqual(req.body.password || '', ADMIN_PASSWORD)) return res.json({ token: criarToken() });
  res.status(401).json({ error: 'Senha incorreta.' });
});
app.get('/api/me', exigirAdmin, (req, res) => res.json({ ok: true }));

/* ---------- Utilidades ---------- */
const parseKeywords = (s) =>
  [...new Set(String(s || '').split(',').map((k) => k.trim()).filter(Boolean))].slice(0, 15);

async function enviarImagem(file) {
  const ext = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' }[file.mimetype];
  const nome = `${Date.now()}-${crypto.randomBytes(4).toString('hex')}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(nome, file.buffer, { contentType: file.mimetype });
  if (error) throw error;
  return supabase.storage.from(BUCKET).getPublicUrl(nome).data.publicUrl;
}
async function removerImagem(url) {
  if (!url) return;
  const nome = url.split(`/${BUCKET}/`)[1];
  if (nome) await supabase.storage.from(BUCKET).remove([decodeURIComponent(nome)]);
}
const erro = (res, e, msg = 'Erro no servidor.') => {
  console.error(e);
  res.status(500).json({ error: msg });
};

/* ---------- Publicações ---------- */
app.get('/api/health', async (req, res) => {
  const { error } = await supabase.from('posts').select('id', { count: 'exact', head: true });
  const b = await supabase.storage.getBucket(BUCKET);
  res.status(error || b.error ? 500 : 200).json({
    banco: error ? `FALHA: ${error.message}` : 'conectado',
    bucket: b.error ? `FALHA: ${b.error.message}` : `"${BUCKET}" encontrado`,
  });
});

app.get('/api/posts', async (req, res) => {
  const { data, error } = await supabase.from('posts').select('*').order('created_at', { ascending: false });
  if (error) return erro(res, error, 'Não foi possível carregar as publicações.');
  const q = String(req.query.q || '').trim().toLowerCase();
  res.json(q ? data.filter((p) => p.title.toLowerCase().includes(q) || p.keywords.some((k) => k.toLowerCase().includes(q))) : data);
});

app.get('/api/posts/:id', async (req, res) => {
  const { data, error } = await supabase.from('posts').select('*').eq('id', req.params.id).single();
  if (error) return res.status(404).json({ error: 'Publicação não encontrada.' });
  res.json(data);
});

app.post('/api/posts', exigirAdmin, upload.single('image'), async (req, res) => {
  try {
    const title = (req.body.title || '').trim(), content = (req.body.content || '').trim();
    if (!title || !content) return res.status(400).json({ error: 'Título e texto são obrigatórios.' });
    const image_url = req.file ? await enviarImagem(req.file) : null;
    const { data, error } = await supabase.from('posts')
      .insert({ title, content, image_url, keywords: parseKeywords(req.body.keywords) }).select().single();
    if (error) throw error;
    res.status(201).json(data);
  } catch (e) { erro(res, e, 'Não foi possível publicar.'); }
});

app.put('/api/posts/:id', exigirAdmin, upload.single('image'), async (req, res) => {
  try {
    const title = (req.body.title || '').trim(), content = (req.body.content || '').trim();
    if (!title || !content) return res.status(400).json({ error: 'Título e texto são obrigatórios.' });
    const { data: atual, error: e1 } = await supabase.from('posts').select('image_url').eq('id', req.params.id).single();
    if (e1) return res.status(404).json({ error: 'Publicação não encontrada.' });

    const campos = { title, content, keywords: parseKeywords(req.body.keywords) }; // created_at não é alterado
    if (req.file) { campos.image_url = await enviarImagem(req.file); await removerImagem(atual.image_url); }
    else if (req.body.remove_image === 'true') { campos.image_url = null; await removerImagem(atual.image_url); }

    const { data, error } = await supabase.from('posts').update(campos).eq('id', req.params.id).select().single();
    if (error) throw error;
    res.json(data);
  } catch (e) { erro(res, e, 'Não foi possível salvar as alterações.'); }
});

app.delete('/api/posts/:id', exigirAdmin, async (req, res) => {
  try {
    const { data } = await supabase.from('posts').select('image_url').eq('id', req.params.id).single();
    const { error } = await supabase.from('posts').delete().eq('id', req.params.id);
    if (error) throw error;
    if (data) await removerImagem(data.image_url);
    res.json({ ok: true });
  } catch (e) { erro(res, e, 'Não foi possível excluir.'); }
});

app.listen(PORT, () => console.log(`Rosa dos Ventos rodando em http://localhost:${PORT}`));
