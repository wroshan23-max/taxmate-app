import { UserRound } from 'lucide-react';
import { RELATIONS } from '../lib/contacts';

/**
 * Contact person inputs (name, relation, mobile, email, "message them instead").
 * form / setForm: the client form object (contact_* keys)
 */
export default function ContactPersonFields({ form, setForm, compact = false }) {
  const set = (k) => (e) => setForm({ ...form, [k]: e.target.type === 'checkbox' ? e.target.checked : e.target.value });
  return (
    <div className="rounded-xl border border-gray-200 bg-gray-50/60 p-3 space-y-3">
      <div className="flex items-center gap-1.5 text-xs font-semibold text-gray-600">
        <UserRound size={14} /> Contact person <span className="font-normal text-gray-400">(optional — e.g. son / daughter who coordinates)</span>
      </div>
      <div className={`grid grid-cols-1 ${compact ? '' : 'sm:grid-cols-2'} gap-3`}>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Name</label>
          <input className="input" placeholder="Kasun Perera" maxLength={150} value={form.contact_name ?? ''} onChange={set('contact_name')} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Relationship to client</label>
          <select className="input" value={form.contact_relation ?? ''} onChange={set('contact_relation')}>
            <option value="">Select…</option>
            {RELATIONS.map(r => <option key={r} value={r}>{r}</option>)}
          </select>
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Mobile / WhatsApp</label>
          <input className="input" inputMode="tel" placeholder="07X XXXXXXX" maxLength={30} value={form.contact_mobile ?? ''} onChange={set('contact_mobile')} />
        </div>
        <div>
          <label className="block text-xs font-semibold text-gray-500 mb-1">Email</label>
          <input className="input" type="email" placeholder="email@example.com" maxLength={150} value={form.contact_email ?? ''} onChange={set('contact_email')} />
        </div>
      </div>
      <label className="flex items-center gap-2 text-sm text-gray-700">
        <input type="checkbox" checked={!!form.contact_preferred} onChange={set('contact_preferred')} disabled={!form.contact_mobile && !form.contact_email} />
        Coordinate with this person — show them first when sending WhatsApp / email
      </label>
    </div>
  );
}

export const CONTACT_KEYS = ['contact_name', 'contact_relation', 'contact_mobile', 'contact_email', 'contact_preferred'];
export const contactPatch = (f) => ({
  contact_name: f.contact_name?.trim() || null,
  contact_relation: f.contact_relation || null,
  contact_mobile: f.contact_mobile?.trim() || null,
  contact_email: f.contact_email?.trim().toLowerCase() || null,
  contact_preferred: !!f.contact_preferred && !!(f.contact_mobile?.trim() || f.contact_email?.trim()),
});
