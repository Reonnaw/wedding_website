(() => {
  'use strict';

  const form = document.getElementById('rsvpForm');
  if (!form || !window.bootstrap) return;

  const STORAGE_KEY = 'rsvp:nadiya-arga';
  const guestsWrap = document.getElementById('rsvpGuestsWrap');
  const guests = document.getElementById('rsvpGuests');
  const message = document.getElementById('rsvpMessage');
  const count = document.getElementById('rsvpCount');
  const guestsCollapse = bootstrap.Collapse.getOrCreateInstance(guestsWrap, { toggle: false });
  const modal = bootstrap.Modal.getOrCreateInstance(document.getElementById('rsvpModal'));
  const toast = bootstrap.Toast.getOrCreateInstance(document.getElementById('rsvpToast'));

  function syncGuests() {
    const coming = form.elements.attending.value === 'yes';
    guests.disabled = !coming;
    guests.required = coming;
    if (coming) guestsCollapse.show();
    else guestsCollapse.hide();
  }

  form.addEventListener('change', (ev) => {
    if (ev.target.name === 'attending') syncGuests();
  });

  message.addEventListener('input', () => {
    count.textContent = message.value.length;
  });

  function load() {
    try {
      return JSON.parse(localStorage.getItem(STORAGE_KEY));
    } catch {
      return null;
    }
  }

  function save(reply) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(reply));
    } catch {
    }
  }

  function send(reply) {
    const endpoint = form.dataset.endpoint;
    if (!endpoint) return Promise.resolve();
    return fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(reply),
    }).then((res) => {
      if (!res.ok) throw new Error(`RSVP failed: ${res.status}`);
    });
  }

  const previous = load();
  if (previous) {
    form.elements.name.value = previous.name || '';
    form.elements.phone.value = previous.phone || '';
    form.elements.message.value = previous.message || '';
    count.textContent = message.value.length;
    const choice = form.querySelector(`input[name="attending"][value="${previous.attending}"]`);
    if (choice) {
      choice.checked = true;
      syncGuests();
      guests.value = previous.guests || '';
    }
  }

  form.addEventListener('submit', (ev) => {
    ev.preventDefault();
    form.elements.name.value = form.elements.name.value.trim();
    form.elements.phone.value = form.elements.phone.value.replace(/[\s-]/g, '');

    if (!form.checkValidity()) {
      form.classList.add('was-validated');
      form.querySelector(':invalid')?.focus();
      return;
    }

    const reply = {
      name: form.elements.name.value,
      phone: form.elements.phone.value,
      attending: form.elements.attending.value,
      guests: form.elements.attending.value === 'yes' ? Number(guests.value) : 0,
      message: message.value.trim(),
      sentAt: new Date().toISOString(),
    };

    const submitBtn = form.querySelector('[type="submit"]');
    submitBtn.disabled = true;
    send(reply)
      .then(() => {
        const updated = Boolean(load());
        save(reply);
        const firstName = reply.name.split(/\s+/)[0];
        document.getElementById('rsvpModalTitle').textContent = `Dear ${firstName}`;
        document.getElementById('rsvpModalText').textContent = reply.attending === 'yes'
          ? `We can't wait to celebrate with you${reply.guests > 1 ? ` and your party of ${reply.guests}` : ''}.`
          : 'We will miss you dearly, and thank you for your kind wishes.';
        form.classList.remove('was-validated');
        modal.show();
        if (updated) toast.show();
      })
      .catch(() => {
        document.getElementById('rsvpModalTitle').textContent = 'Something went wrong';
        document.getElementById('rsvpModalText').textContent = 'Your reply could not be sent. Please try again in a moment.';
        modal.show();
      })
      .finally(() => {
        submitBtn.disabled = false;
      });
  });
})();
