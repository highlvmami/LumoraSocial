import { api, bindPasswordConfirm, handleForm, showAlert } from './common.js';

const $ = (id) => document.getElementById(id);
const requestForm = $('request-form');
const codeForm = $('code-form');
const tokenForm = $('token-form');
const token = new URLSearchParams(location.search).get('token');

bindPasswordConfirm(codeForm.password, codeForm.passwordConfirm);
bindPasswordConfirm(tokenForm.password, tokenForm.passwordConfirm);

function show(el) {
  for (const f of [requestForm, codeForm, tokenForm, $('done')]) f.classList.toggle('hidden', f !== el);
}

if (token) show(tokenForm);

handleForm(requestForm, $('request-alert'), async ({ identifier }) => {
  const res = await api('/auth/forgot-password', { method: 'POST', body: { identifier } });
  showAlert($('request-alert'), res.message, 'success');
  if (res.codeStep) {
    codeForm.phone.value = identifier;
    show(codeForm);
    showAlert($('code-alert'), res.message, 'success');
  }
});

handleForm(codeForm, $('code-alert'), async (data) => {
  await api('/auth/reset-password', { method: 'POST', body: data });
  show($('done'));
});

handleForm(tokenForm, $('token-alert'), async (data) => {
  await api('/auth/reset-password', { method: 'POST', body: { ...data, token } });
  show($('done'));
});
