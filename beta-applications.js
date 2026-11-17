import { readFileSync } from 'node:fs';

const template = readFileSync(new URL('./beta.html', import.meta.url), 'utf8');
const escape = value => String(value ?? '').replace(/[&<>"']/g, char =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const invalid = message => Object.assign(new Error(message), { status: 400, code: 'invalid_beta_application' });
export const betaStatuses = ['pending', 'approved', 'rejected'];

export function betaForm({ submitted = false, error = '' } = {}) {
  if (submitted) return template.replace(/<form class="beta-form"[\s\S]*?<\/form>/,
    '<section class="beta-result" role="status"><h2>Application received.</h2><p>If you’ve already applied, your existing application is still on file.</p><a class="button outline" href="/">Back to NOIR</a></section>');
  return template.replace('<!-- beta-feedback -->', error ? '<p class="beta-result" role="alert">' + escape(error) + '</p>' : '');
}

export function parseBetaApplication(form) {
  const email = (form.get('email') || '').trim().toLowerCase();
  const intendedUse = (form.get('intendedUse') || '').trim();
  const experience = (form.get('experience') || '').trim();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) throw invalid('Enter a valid email address.');
  if (!intendedUse || intendedUse.length > 1500 || experience.length > 1000) throw invalid('Check the length of your answers and try again.');
  if (form.get('consent') !== 'yes') throw invalid('Agree to the beta privacy notice to apply.');
  return { email, intended_use: intendedUse, experience: experience || null, consent_version: 'beta-v1' };
}

export function parseBetaReview(form) {
  const id = form.get('id') || '';
  const action = form.get('action');
  if (!/^[\da-f]{8}-(?:[\da-f]{4}-){3}[\da-f]{12}$/i.test(id)) throw invalid('Invalid application ID.');
  if (action === 'delete' && form.get('confirmDelete') === 'yes') return { p_id: id, p_delete: true };
  const status = form.get('status');
  const slot = form.get('slot');
  const invited = form.get('invited') === 'yes';
  if (action !== 'save' || !betaStatuses.includes(status) || !/^[0-5]$/.test(slot || '') ||
      ((slot !== '0' || invited) && status !== 'approved')) throw invalid('Only approved applicants can be invited or assigned a pilot slot.');
  return { p_id: id, p_status: status, p_slot: Number(slot) || null, p_invited: invited };
}

export function betaAdmin(rows, state = '') {
  const options = (values, current) => values.map(value => '<option value="' + escape(value) + '"' +
    (value === current ? ' selected' : '') + '>' + escape(value === '0' ? 'Unassigned' : value) + '</option>').join('');
  const records = rows.map(row => `<article class="beta-record"><h2>${escape(row.email)}</h2>
  <p>${escape(row.created_at?.slice(0, 10))} UTC · ${escape(row.status)} · ${row.invited ? 'Invited' : 'Invitation pending'}</p>
  <h3>Intended use</h3><p>${escape(row.intended_use)}</p>${row.experience ? '<h3>Testing experience</h3><p>' + escape(row.experience) + '</p>' : ''}
  <form class="beta-form" method="post" action="/admin/beta">
    <input type="hidden" name="id" value="${escape(row.id)}">
    <label>Status<select name="status">${options(betaStatuses, row.status)}</select></label>
    <label>First five tester slot<select name="slot">${options(['0','1','2','3','4','5'], String(row.pilot_slot || 0))}</select></label>
    <label class="consent"><input type="checkbox" name="invited" value="yes"${row.invited ? ' checked' : ''}> Invitation sent manually</label>
    <button class="button outline" name="action" value="save">Save review</button>
    <label class="consent"><input type="checkbox" name="confirmDelete" value="yes"> Confirm permanent deletion</label>
    <button class="button outline" name="action" value="delete">Delete application</button>
  </form></article>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>NOIR Beta Applications</title><link rel="stylesheet" href="/landing.css"></head><body><main class="shell beta-main"><a href="/admin">← Command Center</a><h1>Beta Applications</h1><p>Showing up to 100 applications, newest first. Invitations are sent manually.</p>${state ? '<p class="beta-result" role="status">' + escape(state) + '</p>' : ''}${records || '<p class="beta-result">No applications yet.</p>'}</main></body></html>`;
}
