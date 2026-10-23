import { useEffect, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { supabase, fmtRs, fmtDate } from '../../lib/supabase';
import { useAuth } from '../../contexts/AuthContext';
import { Calculator, FileText, Receipt, Bell, User, Landmark, ChevronRight, ExternalLink, Wallet } from 'lucide-react';
import { safeUrl } from '../../components/LinkifiedText';
import { yearInfo } from '../../lib/assets';
import DueDatesWidget from '../../components/DueDatesWidget';
import { ReturnStepper } from '../../components/ReturnTracker';
import InstallAppCard from '../../components/InstallAppCard';
import { FolderLock, UploadCloud, MessageCircle, Zap, CalendarCheck, FileBadge2 } from 'lucide-react';

export default function ClientDashboard() {
  const { user, profile } = useAuth();
  const [data, setData] = useState({ calcs: [], returns: [], invoices: [], updates: [], assets: [], sheets: [] });
  const [loading, setLoading] = useState(true);
  const features = useOutletContext() ?? { tax_calculator: true };
  const [unread, setUnread] = useState(0);
  useEffect(() => { if (features.messages !== false) supabase.rpc('my_unread_messages').then(({ data }) => setUnread(Number(data) || 0)); }, [features.messages]);

  useEffect(() => {
    const load = async () => {
      // Get client record linked to this user's profile
      const { data: clientRow } = await supabase
        .from('clients')
        .select('id')
        .eq('profile_id', user.id)
        .single();

      if (!clientRow) { setLoading(false); return; }
      const cid = clientRow.id;

      const [{ data: calcs }, { data: returns }, { data: invoices }, { data: updates }, { data: assets }, { data: sheets }] = await Promise.all([
        supabase.from('iit_calculations').select('*').eq('client_id', cid).eq('shared_with_client', true).order('created_at', { ascending: false }).limit(3),
        supabase.from('tax_returns').select('*').eq('client_id', cid).order('created_at', { ascending: false }).limit(3),
        supabase.from('invoices').select('*').eq('client_id', cid).neq('status', 'draft').order('created_at', { ascending: false }).limit(3),
        supabase.from('tax_updates').select('*').eq('published', true).order('created_at', { ascending: false }).limit(3),
        supabase.from('asset_statements').select('id, year, status, admin_note').eq('client_id', cid).eq('status', 'open').order('year', { ascending: false }),
        supabase.from('income_sheets').select('id, year, status, admin_note').eq('client_id', cid).eq('status', 'open').order('year', { ascending: false }),
      ]);
      setData({ calcs: calcs ?? [], returns: returns ?? [], invoices: invoices ?? [], updates: updates ?? [], assets: assets ?? [], sheets: sheets ?? [] });
      setLoading(false);
    };
    load();
  }, [user.id]);

  if (loading) return <div className="flex items-center justify-center h-64 text-gray-400">Loading...</div>;

  const unpaidTotal = data.invoices.filter(i => i.status === 'unpaid' || i.status === 'overdue').reduce((s, i) => s + (i.total_amount || 0), 0);

  const stats = [
    { label: 'Tax Calculations', value: data.calcs.length, icon: Calculator, color: 'bg-blue-50 text-blue-600', link: '/client/calculations' },
    { label: 'Tax Returns', value: data.returns.length, icon: FileText, color: 'bg-purple-50 text-purple-600', link: '/client/tax-returns' },
    { label: 'Unpaid Amount', value: fmtRs(unpaidTotal), icon: Receipt, color: 'bg-red-50 text-red-600', link: '/client/invoices' },
    { label: 'Tax Updates', value: data.updates.length, icon: Bell, color: 'bg-amber-50 text-amber-600', link: '/client/updates' },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-primary-800">Welcome, {profile?.full_name?.split(' ')[0] ?? 'Client'} 👋</h1>
        <p className="text-sm text-gray-500">Your TaxMate dashboard</p>
      </div>

      {unread > 0 && (
        <Link to="/client/messages" className="flex items-center gap-3 rounded-xl border border-primary-200 bg-primary-50 p-4 hover:bg-primary-100 transition-colors">
          <div className="relative w-10 h-10 rounded-xl bg-primary-600 text-white flex items-center justify-center flex-shrink-0"><MessageCircle size={20} />
            <span className="absolute -top-1.5 -right-1.5 text-[10px] font-black bg-red-500 text-white rounded-full px-1.5 min-w-[18px] text-center ring-2 ring-white">{unread}</span></div>
          <div className="flex-1">
            <div className="font-semibold text-primary-900">You have {unread} new message{unread > 1 ? 's' : ''} from TaxMate</div>
            <div className="text-xs text-primary-700">Tap to read · TaxMate වෙතින් නව පණිවිඩ</div>
          </div>
          <ChevronRight size={18} className="text-primary-600" />
        </Link>
      )}

      {data.sheets.map(sh => (
        <Link key={sh.id} to={`/client/income?year=${encodeURIComponent(sh.year)}`}
          className="flex items-center gap-3 rounded-xl border border-orange-300 bg-orange-50 p-4 hover:bg-orange-100 transition-colors">
          <div className="w-10 h-10 rounded-xl bg-orange-200 text-orange-900 flex items-center justify-center flex-shrink-0"><Wallet size={20} /></div>
          <div className="flex-1">
            <div className="font-semibold text-orange-900">{sh.admin_note ? 'Please update' : 'Please fill'} your monthly income for Y/A {sh.year}</div>
            <div className="text-xs text-orange-800">Salary, rent, interest, foreign income and business income &amp; expenses · මාසික ආදායම ඇතුළත් කරන්න</div>
          </div>
          <ChevronRight size={18} className="text-orange-700" />
        </Link>
      ))}

      {data.assets.map(a => (
        <Link key={a.id} to={`/client/assets?year=${encodeURIComponent(a.year)}`}
          className="flex items-center gap-3 rounded-xl border border-amber-300 bg-amber-50 p-4 hover:bg-amber-100 transition-colors">
          <div className="w-10 h-10 rounded-xl bg-amber-200 text-amber-900 flex items-center justify-center flex-shrink-0"><Landmark size={20} /></div>
          <div className="flex-1">
            <div className="font-semibold text-amber-900">{a.admin_note ? 'Please update' : 'Please fill'} your Assets &amp; Liabilities for Y/A {a.year}</div>
            <div className="text-xs text-amber-800">As at {yearInfo(a.year).asAt} — needed for your Income Tax Return · වත්කම් හා බැරකම් පත්‍රය පුරවන්න</div>
          </div>
          <ChevronRight size={18} className="text-amber-700" />
        </Link>
      ))}

      {features.return_tracker !== false && data.returns.length > 0 && (
        <div className="card overflow-hidden">
          <div className="card-header"><FileText size={16} /> My Tax Return progress
            <Link to="/client/tax-returns" className="ml-auto text-xs font-semibold text-primary-600 hover:underline flex items-center gap-0.5">Details <ChevronRight size={13} /></Link>
          </div>
          <div className="divide-y divide-gray-100">
            {data.returns.slice(0, 2).map(r => (
              <div key={r.id} className="px-4 sm:px-6 py-4">
                <div className="text-sm font-bold text-gray-800 mb-2">Y/A {r.year}</div>
                <ReturnStepper ret={r} showSinhala />
              </div>
            ))}
          </div>
        </div>
      )}

      {features.documents !== false && (
        <Link to="/client/documents" className="group flex items-center gap-4 rounded-2xl border border-primary-100 bg-gradient-to-r from-primary-50 via-white to-gold-500/10 p-4 hover:shadow-md transition-all">
          <div className="w-12 h-12 rounded-2xl bg-gradient-to-br from-primary-600 to-indigo-600 text-white flex items-center justify-center flex-shrink-0 shadow-md group-hover:scale-105 transition-transform"><FolderLock size={22} /></div>
          <div className="flex-1 min-w-0">
            <div className="font-bold text-primary-800">My Documents</div>
            <div className="text-xs text-gray-500">Upload salary slips, bank certificates &amp; more — snap a photo from your phone · ලේඛන මෙතනින් එවන්න</div>
          </div>
          <span className="hidden sm:inline-flex items-center gap-1 text-sm font-bold bg-gold-500 text-primary-900 rounded-xl px-3 py-1.5"><UploadCloud size={15} /> Upload</span>
          <ChevronRight size={18} className="sm:hidden text-primary-600" />
        </Link>
      )}

      <InstallAppCard />

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {features.quick_tax !== false && (
          <Link to="/client/quick-tax" className="group card p-4 flex items-center gap-3 hover:shadow-md transition-all">
            <div className="w-11 h-11 rounded-2xl bg-gold-500 text-primary-900 flex items-center justify-center group-hover:scale-105 transition-transform"><Zap size={20} /></div>
            <div><div className="font-bold text-sm text-gray-800">Quick Tax Check</div><div className="text-[11px] text-gray-500">See your tax in seconds</div></div>
          </Link>
        )}
        {features.services !== false && (
          <Link to="/client/services" className="group card p-4 flex items-center gap-3 hover:shadow-md transition-all">
            <div className="w-11 h-11 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center group-hover:scale-105 transition-transform"><CalendarCheck size={20} /></div>
            <div><div className="font-bold text-sm text-gray-800">Book a service</div><div className="text-[11px] text-gray-500">VAT, TIN, company tax & more</div></div>
          </Link>
        )}
        {features.summary_letters !== false && (
          <Link to="/client/tax-returns" className="group card p-4 flex items-center gap-3 hover:shadow-md transition-all">
            <div className="w-11 h-11 rounded-2xl bg-emerald-100 text-emerald-700 flex items-center justify-center group-hover:scale-105 transition-transform"><FileBadge2 size={20} /></div>
            <div><div className="font-bold text-sm text-gray-800">Tax summary letter</div><div className="text-[11px] text-gray-500">For visa & bank loans</div></div>
          </Link>
        )}
      </div>

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {stats.map(({ label, value, icon: Icon, color, link }) => (
          <Link key={label} to={link} className="card p-4 hover:shadow-md transition-shadow">
            <div className={`w-10 h-10 rounded-xl flex items-center justify-center mb-3 ${color}`}>
              <Icon size={20} />
            </div>
            <div className="text-xl font-bold text-gray-800">{value}</div>
            <div className="text-xs text-gray-500 mt-0.5">{label}</div>
          </Link>
        ))}
      </div>

      {(features.tax_calendar !== false || features.referrals !== false) && (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
          {features.tax_calendar !== false && <DueDatesWidget role="client" withReminders={features.reminders !== false} max={5} />}
          {features.referrals !== false && (
            <Link to="/client/invite" className="relative overflow-hidden rounded-2xl bg-gradient-to-br from-primary-700 via-primary-800 to-indigo-900 text-white p-5 shadow-lg flex flex-col justify-between min-h-[180px] hover:shadow-xl transition-shadow">
              <div className="absolute -right-8 -top-8 w-36 h-36 rounded-full bg-gold-500/25 blur-2xl" />
              <div className="relative">
                <div className="text-3xl">🎁</div>
                <div className="font-black text-lg mt-1 leading-tight">Invite friends &amp; family</div>
                <div className="text-sm text-primary-200">Help them file their tax the easy way · යාළුවන්ට TaxMate හඳුන්වා දෙන්න</div>
                {features.referral_reward && <div className="mt-2 text-sm font-semibold text-gold-500">{features.referral_reward}</div>}
              </div>
              <div className="relative mt-3 inline-flex items-center gap-1 text-sm font-bold bg-gold-500 text-primary-900 rounded-xl px-3 py-1.5 w-fit">Get my invite link <ChevronRight size={15} /></div>
            </Link>
          )}
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-5">
        {/* Recent Updates */}
        <div className="card">
          <div className="card-header"><Bell size={16} /> Latest Tax Updates</div>
          {data.updates.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">No updates yet</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {data.updates.map(u => (
                <div key={u.id} className="px-5 py-3 flex items-start gap-2">
                  <Link to="/client/updates" className="flex-1 min-w-0 group">
                    <div className="text-sm font-semibold text-gray-800 group-hover:text-primary-700">{u.title}</div>
                    <div className="text-xs text-gray-400 mt-0.5">{fmtDate(u.created_at)}</div>
                  </Link>
                  {safeUrl(u.link_url) && (
                    <a href={u.link_url} target="_blank" rel="noopener noreferrer" title={u.link_label || 'Open link'}
                      className="flex-shrink-0 inline-flex items-center gap-1 text-xs font-semibold text-primary-700 bg-primary-50 hover:bg-primary-100 px-2 py-1 rounded-md">
                      <ExternalLink size={12} /> {u.link_label ? (u.link_label.length > 18 ? 'Open' : u.link_label) : 'Open'}
                    </a>
                  )}
                </div>
              ))}
            </div>
          )}
          <div className="px-5 pb-4">
            <Link to="/client/updates" className="text-xs text-primary-600 hover:underline">View all →</Link>
          </div>
        </div>

        {/* Recent Invoices */}
        <div className="card">
          <div className="card-header"><Receipt size={16} /> Recent Invoices</div>
          {data.invoices.length === 0 ? (
            <div className="p-6 text-center text-gray-400 text-sm">No invoices yet</div>
          ) : (
            <div className="divide-y divide-gray-50">
              {data.invoices.map(inv => (
                <div key={inv.id} className="flex items-center gap-3 px-5 py-3">
                  <div className="flex-1">
                    <div className="text-sm font-semibold">{inv.invoice_no}</div>
                    <div className="text-xs text-gray-400">{fmtDate(inv.issue_date)}</div>
                  </div>
                  <div className="text-sm font-bold text-primary-700">{fmtRs(inv.total_amount)}</div>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${inv.status === 'paid' ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'}`}>
                    {inv.status}
                  </span>
                </div>
              ))}
            </div>
          )}
          <div className="px-5 pb-4">
            <Link to="/client/invoices" className="text-xs text-primary-600 hover:underline">View all →</Link>
          </div>
        </div>
      </div>

      {/* Quick Links */}
      <div className="card p-4">
        <div className="text-sm font-semibold text-gray-600 mb-3">Quick Actions</div>
        <div className="flex flex-wrap gap-3">
          {features.tax_calculator && (
            <Link to="/client/tax-calculator" className="flex items-center gap-2 px-4 py-2 bg-gold-500 text-primary-900 rounded-lg text-sm font-semibold hover:opacity-90 transition-opacity">
              <Calculator size={15} /> Tax Calculator
            </Link>
          )}
          {features.income_sheets > 0 && (
            <Link to="/client/income" className="flex items-center gap-2 px-4 py-2 bg-orange-50 text-orange-800 rounded-lg text-sm font-semibold hover:bg-orange-100 transition-colors">
              <Wallet size={15} /> Monthly Income
            </Link>
          )}
          <Link to="/client/profile" className="flex items-center gap-2 px-4 py-2 bg-primary-50 text-primary-700 rounded-lg text-sm font-semibold hover:bg-primary-100 transition-colors">
            <User size={15} /> Update My Profile
          </Link>
          <Link to="/client/calculations" className="flex items-center gap-2 px-4 py-2 bg-blue-50 text-blue-700 rounded-lg text-sm font-semibold hover:bg-blue-100 transition-colors">
            <Calculator size={15} /> View My Calculations
          </Link>
          <Link to="/client/tax-returns" className="flex items-center gap-2 px-4 py-2 bg-purple-50 text-purple-700 rounded-lg text-sm font-semibold hover:bg-purple-100 transition-colors">
            <FileText size={15} /> Check Returns
          </Link>
        </div>
      </div>
    </div>
  );
}
