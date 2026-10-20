import { useEffect, useState } from 'react';
import { supabase, fmtDate } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import toast from 'react-hot-toast';
import { Plus, Bell, X, Trash2, Eye, EyeOff, Edit2, ExternalLink, Link2 } from 'lucide-react';
import LinkifiedText, { safeUrl, hostOf } from '../../components/LinkifiedText';

const EMPTY = { title: '', body: '', tag: 'general', published: true, link_url: '', link_label: '' };

const tagColors = {
  general: 'badge-blue',
  deadline: 'badge-red',
  rate_change: 'badge-yellow',
  new_regulation: 'badge-green',
};

export default function TaxUpdates() {
  const { user } = useAuth();
  const [updates, setUpdates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState(false);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY);
  const [editId, setEditId] = useState(null);   // null = new post

  useEffect(() => { loadUpdates(); }, []);

  const loadUpdates = async () => {
    const { data } = await supabase
      .from('tax_updates')
      .select('*')
      .order('created_at', { ascending: false });
    setUpdates(data ?? []);
    setLoading(false);
  };

  const openNew = () => { setEditId(null); setForm(EMPTY); setModal(true); };
  const openEdit = (u) => {
    setEditId(u.id);
    setForm({ title: u.title ?? '', body: u.body ?? '', tag: u.tag ?? 'general', published: !!u.published, link_url: u.link_url ?? '', link_label: u.link_label ?? '' });
    setModal(true);
  };
  const closeModal = () => { setModal(false); setEditId(null); setForm(EMPTY); };

  const save = async (e) => {
    e.preventDefault();
    if (!form.title.trim() || !form.body.trim()) return toast.error('Title and body required');
    let link = form.link_url.trim();
    if (link && !/^https?:\/\//i.test(link)) link = `https://${link}`;   // "ird.gov.lk/..." → https://ird.gov.lk/...
    if (link && !safeUrl(link)) return toast.error('The link must be a web address, e.g. https://www.ird.gov.lk/...');
    const row = {
      title: form.title.trim(), body: form.body.trim(), tag: form.tag, published: form.published,
      link_url: link || null, link_label: link ? (form.link_label.trim() || null) : null,
    };
    setSaving(true);
    const { error } = editId
      ? await supabase.from('tax_updates').update({ ...row, updated_at: new Date().toISOString() }).eq('id', editId)
      : await supabase.from('tax_updates').insert({ ...row, created_by: user.id });
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(editId ? 'Update saved' : row.published ? 'Update published!' : 'Saved as draft');
    closeModal();
    loadUpdates();
  };

  const togglePublished = async (id, current) => {
    await supabase.from('tax_updates').update({ published: !current }).eq('id', id);
    toast.success(!current ? 'Published' : 'Unpublished');
    loadUpdates();
  };

  const deleteUpdate = async (id) => {
    if (!confirm('Delete this update?')) return;
    await supabase.from('tax_updates').delete().eq('id', id);
    toast.success('Deleted');
    loadUpdates();
  };

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-bold text-primary-800">Tax Updates</h1>
          <p className="text-sm text-gray-500">Notices visible to clients</p>
        </div>
        <button onClick={openNew} className="btn-primary ml-auto">
          <Plus size={16} /> Post Update
        </button>
      </div>

      <div className="space-y-3">
        {loading ? (
          <div className="card p-8 text-center text-gray-400">Loading...</div>
        ) : updates.length === 0 ? (
          <div className="card p-12 text-center">
            <Bell size={40} className="mx-auto text-gray-200 mb-3" />
            <div className="text-gray-400">No updates posted yet</div>
          </div>
        ) : updates.map(u => (
          <div key={u.id} className={`card p-4 ${!u.published ? 'opacity-60' : ''}`}>
            <div className="flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap mb-1">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${tagColors[u.tag] ?? 'badge-gray'}`}>
                    {u.tag?.replace('_', ' ')}
                  </span>
                  {!u.published && <span className="text-xs text-gray-400 italic">Draft</span>}
                  <span className="text-xs text-gray-400 ml-auto">{fmtDate(u.created_at)}</span>
                </div>
                <h3 className="font-bold text-gray-800 mb-1">{u.title}</h3>
                <LinkifiedText text={u.body} className="text-sm text-gray-600 whitespace-pre-line" />
                {safeUrl(u.link_url) && (
                  <a href={u.link_url} target="_blank" rel="noopener noreferrer"
                    className="inline-flex items-center gap-1.5 mt-2 text-sm font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 px-3 py-1.5 rounded-lg">
                    <ExternalLink size={14} /> {u.link_label || 'Open link'} <span className="text-xs font-normal text-primary-500">· {hostOf(u.link_url)}</span>
                  </a>
                )}
              </div>
              <div className="flex items-center gap-1 flex-shrink-0">
                <button onClick={() => openEdit(u)} title="Edit"
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-primary-600 transition-colors">
                  <Edit2 size={16} />
                </button>
                <button
                  onClick={() => togglePublished(u.id, u.published)}
                  title={u.published ? 'Unpublish' : 'Publish'}
                  className="p-1.5 rounded-lg hover:bg-gray-100 text-gray-400 hover:text-primary-600 transition-colors"
                >
                  {u.published ? <Eye size={16} /> : <EyeOff size={16} />}
                </button>
                <button
                  onClick={() => deleteUpdate(u.id)}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-gray-400 hover:text-red-500 transition-colors"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg">
            <div className="flex items-center justify-between p-5 border-b">
              <h3 className="font-bold text-primary-800">{editId ? 'Edit Tax Update' : 'Post Tax Update'}</h3>
              <button onClick={closeModal} className="text-gray-400 hover:text-gray-600"><X size={20} /></button>
            </div>
            <form onSubmit={save} className="p-5 space-y-4 max-h-[80vh] overflow-y-auto">
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Title *</label>
                <input className="input" placeholder="e.g. IIT Filing Deadline Extended" value={form.title}
                  onChange={e => setForm({...form, title: e.target.value})} required />
              </div>
              <div>
                <label className="block text-xs font-semibold text-gray-500 mb-1">Body *</label>
                <textarea className="input resize-none" rows={5} placeholder="Full update details..." value={form.body}
                  onChange={e => setForm({...form, body: e.target.value})} required />
              </div>
              <div className="rounded-xl border border-gray-200 p-3 space-y-3 bg-gray-50/60">
                <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600"><Link2 size={14} /> Link (optional)</div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Web address</label>
                  <input className="input" inputMode="url" placeholder="https://www.ird.gov.lk/... or your blog / YouTube / Facebook post"
                    value={form.link_url} onChange={e => setForm({ ...form, link_url: e.target.value })} />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Button text</label>
                  <input className="input" maxLength={60} placeholder="e.g. Read the IRD notice · Watch the video" disabled={!form.link_url.trim()}
                    value={form.link_label} onChange={e => setForm({ ...form, link_label: e.target.value })} />
                </div>
                <p className="text-[11px] text-gray-400">Clients see a button under the update and the link opens in a new tab. Links typed inside the body text are clickable too.</p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Category</label>
                  <select className="input" value={form.tag} onChange={e => setForm({...form, tag: e.target.value})}>
                    <option value="general">General</option>
                    <option value="deadline">Deadline</option>
                    <option value="rate_change">Rate Change</option>
                    <option value="new_regulation">New Regulation</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-gray-500 mb-1">Visibility</label>
                  <select className="input" value={form.published ? 'yes' : 'no'} onChange={e => setForm({...form, published: e.target.value === 'yes'})}>
                    <option value="yes">Published (visible to clients)</option>
                    <option value="no">Draft (hidden)</option>
                  </select>
                </div>
              </div>
              <div className="flex gap-3">
                <button type="button" onClick={closeModal} className="btn-secondary flex-1 justify-center">Cancel</button>
                <button type="submit" disabled={saving} className="btn-primary flex-1 justify-center">{saving ? 'Saving...' : editId ? 'Save Changes' : 'Post Update'}</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
