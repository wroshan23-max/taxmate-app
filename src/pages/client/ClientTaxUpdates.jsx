import { useEffect, useState } from 'react';
import { supabase, fmtDate } from '../../lib/supabase';
import { Bell, ExternalLink } from 'lucide-react';
import LinkifiedText, { safeUrl, hostOf } from '../../components/LinkifiedText';

const tagColors = {
  general: 'bg-blue-100 text-blue-700',
  deadline: 'bg-red-100 text-red-700',
  rate_change: 'bg-amber-100 text-amber-700',
  new_regulation: 'bg-green-100 text-green-700',
};

export default function ClientTaxUpdates() {
  const [updates, setUpdates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');

  useEffect(() => {
    const load = async () => {
      const { data } = await supabase
        .from('tax_updates')
        .select('*')
        .eq('published', true)
        .order('created_at', { ascending: false });
      setUpdates(data ?? []);
      setLoading(false);
    };
    load();
  }, []);

  const tags = ['all', 'general', 'deadline', 'rate_change', 'new_regulation'];
  const filtered = updates.filter(u => filter === 'all' || u.tag === filter);

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-primary-800">Tax Updates</h1>
        <p className="text-sm text-gray-500">Latest notices from TaxMate Solutions</p>
      </div>

      <div className="flex gap-2 flex-wrap">
        {tags.map(t => (
          <button key={t} onClick={() => setFilter(t)}
            className={`px-3 py-1 rounded-full text-xs font-semibold capitalize transition-all ${filter === t ? 'bg-primary-700 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>
            {t.replace('_', ' ')}
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <div className="card p-12 text-center">
          <Bell size={40} className="mx-auto text-gray-200 mb-3" />
          <div className="text-gray-400">No updates found</div>
        </div>
      ) : (
        <div className="space-y-4">
          {filtered.map(u => (
            <div key={u.id} className="card p-5">
              <div className="flex items-start gap-3">
                <div className="flex-shrink-0 mt-0.5">
                  <div className="w-9 h-9 rounded-full bg-primary-100 flex items-center justify-center">
                    <Bell size={16} className="text-primary-700" />
                  </div>
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap mb-1">
                    <span className={`text-xs px-2 py-0.5 rounded-full font-semibold capitalize ${tagColors[u.tag] ?? 'bg-gray-100 text-gray-600'}`}>
                      {u.tag?.replace('_', ' ')}
                    </span>
                    <span className="text-xs text-gray-400">{fmtDate(u.created_at)}</span>
                  </div>
                  <h3 className="font-bold text-gray-800 mb-2">{u.title}</h3>
                  <LinkifiedText text={u.body} className="text-sm text-gray-600 whitespace-pre-line leading-relaxed" />
                  {safeUrl(u.link_url) && (
                    <a href={u.link_url} target="_blank" rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 mt-3 text-sm font-semibold text-white bg-primary-600 hover:bg-primary-700 px-4 py-2 rounded-lg shadow-sm">
                      <ExternalLink size={15} /> {u.link_label || 'Read more'}
                      <span className="text-xs font-normal text-primary-100">· {hostOf(u.link_url)}</span>
                    </a>
                  )}
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="card p-4 bg-primary-50 border border-primary-100">
        <div className="text-sm font-semibold text-primary-800 mb-1">Need clarification?</div>
        <p className="text-xs text-primary-700">
          If you have questions about any tax update, please reach out to TaxMate Solutions directly via WhatsApp or email.
        </p>
      </div>
    </div>
  );
}
