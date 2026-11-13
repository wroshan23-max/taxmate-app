// V64 — VAT Invoice: database calls. Every change goes through a checked database function;
// tables are only read directly (row-level security lets each business see its own rows).
import { supabase } from '../supabase';

const rpc = async (fn, args) => {
  const { data, error } = await supabase.rpc(fn, args);
  if (error) throw new Error(error.message);
  return data;
};
const rows = async (q) => {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return data ?? [];
};

// context & setup
export const vatContext = (clientId) => rpc('vi_context', { p_client: clientId });
export const myWorkspaces = () => rpc('vi_my_workspaces');
export const loadSettings = async (clientId) => (await rows(supabase.from('vi_settings').select('*').eq('client_id', clientId)))[0] ?? null;
export const saveSettings = (clientId, p) => rpc('vi_save_settings', { p_client: clientId, p });
export const loadRates = () => rows(supabase.from('vi_tax_rates').select('*').order('code').order('effective_from'));
export const loadScheduleMap = () => rows(supabase.from('vi_schedule_map').select('*').order('key'));
export const loadBranches = (clientId) => rows(supabase.from('vi_branches').select('*').eq('client_id', clientId).order('code'));
export const saveBranch = (clientId, p) => rpc('vi_save_branch', { p_client: clientId, p });
export const loadSequences = (clientId) => rows(supabase.from('vi_sequences').select('*').eq('client_id', clientId).order('doc_type').order('code'));
export const saveSequence = (clientId, p) => rpc('vi_save_sequence', { p_client: clientId, p });
export const previewNo = (clientId, type, code, date) => rpc('vi_preview_no', { p_client: clientId, p_type: type, p_code: code || 'MAIN', p_date: date });
export const loadMembers = (clientId) => rows(supabase.from('vi_members').select('*').eq('client_id', clientId).order('created_at'));
export const saveMember = (clientId, email, role, active = true) => rpc('vi_save_member', { p_client: clientId, p_email: email, p_role: role, p_active: active });
export const removeMember = (id) => rpc('vi_remove_member', { p_id: id });
export const requestAddon = (cycle, note) => rpc('request_addon_cycle', { p_key: 'vat_invoice', p_cycle: cycle, p_note: note || null });

// customers & items
export const loadCustomers = (clientId) => rows(supabase.from('vi_customers').select('*').eq('client_id', clientId).order('name'));
export const saveCustomer = (clientId, p) => rpc('vi_save_customer', { p_client: clientId, p });
export const loadItems = (clientId) => rows(supabase.from('vi_items').select('*').eq('client_id', clientId).order('name'));
export const saveItem = (clientId, p) => rpc('vi_save_item', { p_client: clientId, p });
export const customerLedger = (clientId, customerId, from, to) => rpc('vi_customer_ledger', { p_client: clientId, p_customer: customerId, p_from: from || null, p_to: to || null });

// documents
const DOC_COLS = 'id, client_id, doc_type, is_tax, status, doc_no, branch_id, issue_date, supply_date, due_date, terms_days, customer_id, customer, original_id, reason_code, reason, '
  + 'price_mode, gross, discount_total, taxable_standard, taxable_zero, exempt_amount, net_total, vat_total, total, credited, debited, paid, balance, pay_status, '
  + 'ramis_status, ramis_ref, ramis_message, locked_at, created_by, issued_by, share_token, share_expires_at, share_views, reminder_count, last_reminder_at, issued_at, cancelled_at, cancel_reason, replaced_by, created_at, updated_at';
export async function loadDocs(clientId, { from, to, limit = 5000 } = {}) {
  let q = supabase.from('vi_documents').select(DOC_COLS).eq('client_id', clientId).order('issue_date', { ascending: false }).order('created_at', { ascending: false }).limit(limit);
  if (from) q = q.gte('issue_date', from);
  if (to) q = q.lte('issue_date', to);
  return rows(q);
}
export const loadDoc = async (id) => (await rows(supabase.from('vi_documents').select('*').eq('id', id)))[0] ?? null;
export const loadLines = (docId) => rows(supabase.from('vi_document_lines').select('*').eq('doc_id', docId).order('sort'));
export const loadLinesFor = (clientId, from, to) => rows(supabase.from('vi_document_lines')
  .select('doc_id, treatment, rate, net, vat, total, schedule, supply_kind, vi_documents!inner(doc_type, status, issue_date, is_tax, client_id)')
  .eq('client_id', clientId).gte('vi_documents.issue_date', from).lte('vi_documents.issue_date', to).limit(20000));
export const saveDraft = (clientId, doc, lines) => rpc('vi_save_draft', { p_client: clientId, p_doc: doc, p_lines: lines });
export const deleteDraft = (id) => rpc('vi_delete_draft', { p_doc: id });
export const issueDoc = (id) => rpc('vi_issue', { p_doc: id });
export const validateDoc = (id, forRamis = false) => rpc('vi_validate', { p_doc: id, p_for_ramis: forRamis });
export const cancelDoc = (id, reason) => rpc('vi_cancel', { p_doc: id, p_reason: reason });
export const copyDoc = (id, asType) => rpc('vi_copy', { p_doc: id, p_as_type: asType || null });
export const correctRejected = (id) => rpc('vi_correct_rejected', { p_doc: id });
export const docJson = (id) => rpc('vi_document_json', { p_doc: id });
export const logEvent = (id, action, note) => rpc('vi_log_event', { p_doc: id, p_action: action, p_note: note || null }).catch(() => {});
export const shareDoc = (id, days) => rpc('vi_share', { p_doc: id, p_days: days || null });
export const shareOff = (id) => rpc('vi_share_off', { p_doc: id });
export const publicDoc = (token) => rpc('vi_public_document', { p_token: token });
export const invoiceUrl = (token) => `${window.location.origin}/i/${token}`;

// payments
export const loadPayments = (clientId) => rows(supabase.from('vi_payments').select('*').eq('client_id', clientId).order('paid_on', { ascending: false }).order('created_at', { ascending: false }).limit(5000));
export const loadAllocations = (clientId) => rows(supabase.from('vi_payment_allocations').select('payment_id, doc_id, amount').eq('client_id', clientId).limit(20000));
export const recordPayment = (clientId, p, allocs = []) => rpc('vi_record_payment', { p_client: clientId, p, p_allocs: allocs });
export const voidPayment = (id, reason) => rpc('vi_void_payment', { p_id: id, p_reason: reason });
export async function uploadVatFile(clientId, folder, file) {
  if (file.size > 5 * 1024 * 1024) throw new Error('Files up to 5 MB.');
  const safe = file.name.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-80);
  const path = `${clientId}/${folder}/${crypto.randomUUID()}-${safe}`;
  const { error } = await supabase.storage.from('vat-files').upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  return path;
}
export async function vatFileUrl(path) {
  const { data, error } = await supabase.storage.from('vat-files').createSignedUrl(path, 300);
  if (error) throw new Error(error.message);
  return data.signedUrl;
}

// reminders
export const loadReminders = (clientId, docId) => {
  let q = supabase.from('vi_reminders').select('*').eq('client_id', clientId).order('created_at', { ascending: false }).limit(500);
  if (docId) q = q.eq('doc_id', docId);
  return rows(q);
};
export const logReminder = (docId, channel, recipient, message) => rpc('vi_log_reminder', { p_doc: docId, p_channel: channel, p_recipient: recipient || null, p_message: message || null });
export async function emailDocument(docId, kind = 'document') {
  const { data, error } = await supabase.functions.invoke('vatinvoice', { body: { action: 'email_document', doc_id: docId, kind } });
  if (error) throw new Error(error.message || 'Email service not reachable.');
  if (data?.error) throw new Error(data.error);
  return data;
}

// RAMIS
export const ramisInfo = (clientId) => rpc('vi_ramis_info', { p_client: clientId });
export const saveRamisConfig = (clientId, p) => rpc('vi_save_ramis_config', { p_client: clientId, p });
export const submitRamis = (id) => rpc('vi_submit_ramis', { p_doc: id });
export const withdrawRamis = (id) => rpc('vi_ramis_withdraw', { p_doc: id });
export const retryRamis = (id) => rpc('vi_ramis_retry', { p_doc: id });
export const loadSubmissions = (clientId) => rows(supabase.from('vi_ramis_submissions')
  .select('id, doc_id, submission_no, kind, adapter_version, environment, status, attempts, max_attempts, next_attempt_at, last_http_status, ramis_status, ramis_ref, error_code, error_message, created_at, updated_at, submitted_at, responded_at, payload_hash')
  .eq('client_id', clientId).order('created_at', { ascending: false }).limit(2000));

// purchases
export const loadPurchases = (clientId) => rows(supabase.from('vi_purchases').select('*').eq('client_id', clientId).order('invoice_date', { ascending: false }).limit(5000));
export const savePurchase = (clientId, p) => rpc('vi_save_purchase', { p_client: clientId, p });
export const importPurchases = (clientId, list) => rpc('vi_import_purchases', { p_client: clientId, p_rows: list });
export const reviewPurchase = (id, approval, note, disallowed, period) => rpc('vi_review_purchase', { p_id: id, p_approval: approval, p_note: note || null, p_disallowed: disallowed ?? null, p_period: period || null });
export const deletePurchase = (id) => rpc('vi_delete_purchase', { p_id: id });
export const purchaseDocument = (id) => rpc('vi_purchase_document', { p_id: id });

// audit
export const loadAudit = (clientId, docId) => {
  let q = supabase.from('vi_audit').select('id, doc_id, entity, entity_id, action, actor, actor_role, ip, old_value, new_value, note, created_at').eq('client_id', clientId).order('id', { ascending: false }).limit(docId ? 300 : 1000);
  if (docId) q = q.eq('doc_id', docId);
  return rows(q);
};

// admin
export const adminOverview = () => rpc('admin_vi_overview');
export const adminSaveRate = (p) => rpc('admin_vi_save_rate', { p });
export const adminSaveSchedule = (p) => rpc('admin_vi_save_schedule', { p });
export const adminCompliance = (p) => rpc('admin_vi_compliance', { p });
export const adminRamisApi = (p) => rpc('admin_vi_ramis_api', { p });
export const adminReleasePending = () => rpc('admin_vi_release_pending');
export const adminRamisLog = (subId) => rpc('admin_vi_ramis_log', { p_sub: subId });
export const loadComplianceUpdates = () => rows(supabase.from('vi_compliance_updates').select('*').order('created_at', { ascending: false }).limit(200));
export async function ramisRunNow() {
  const { data, error } = await supabase.functions.invoke('vatinvoice', { body: { action: 'ramis_now' } });
  if (error) throw new Error(error.message);
  if (data?.error) throw new Error(data.error);
  return data;
}

// one document's payments and RAMIS submissions
export const loadDocPayments = (docId) => rows(supabase.from('vi_payment_allocations').select('amount, payment_id, vi_payments(*)').eq('doc_id', docId));
export const loadDocSubmissions = (docId) => rows(supabase.from('vi_ramis_submissions')
  .select('id, submission_no, kind, adapter_version, environment, status, attempts, max_attempts, next_attempt_at, last_http_status, ramis_status, ramis_ref, error_code, error_message, created_at, updated_at, responded_at')
  .eq('doc_id', docId).order('created_at', { ascending: false }));
